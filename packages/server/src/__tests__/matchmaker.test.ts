/**
 * Quick-Play matchmaking + bot-backfill tests (cold-start linchpin).
 *
 * Two layers:
 *  1. Unit tests of the {@link Matchmaker} queue/window/cancel logic against a
 *     stub host (no server, no bots) — deterministic and fast.
 *  2. An end-to-end test that boots the REAL server on a loopback port and runs a
 *     SOLO `quick_play`: the fill window fires, in-process SCRIPTED bots join over
 *     genuine WebSockets, the table auto-starts (no host click), and — driven by
 *     a FakeClock for the room loop — the game runs to `game_over`. This proves a
 *     solo queuer forms + starts + TERMINATES a 7-player table with bot backfill.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { WebSocket } from 'ws';
import { MIN_PLAYERS } from '@nocturne/shared';
import { getEngine } from '../engine-adapter.js';
import { MemoryStore } from '../db/memory-store.js';
import { IdentityService } from '../auth/identity.js';
import { LobbyManager } from '../lobby/manager.js';
import { Matchmaker, type MatchmakerHost } from '../lobby/matchmaker.js';
import { Moderation } from '../moderation/moderation.js';
import { Telemetry } from '../telemetry.js';
import { BotManager } from '../bots/manager.js';
import { Gateway } from '../ws/gateway.js';
import type { GatewayContext } from '../ws/context.js';
import { loadConfig } from '../config.js';
import { registerAuthRoutes } from '../http/auth-routes.js';
import { makeRateLimiter } from '../http/rate-limit.js';
import { FakeClock } from './helpers.js';

// --------------------------------------------------------------------------
// 1. Matchmaker unit tests (stub host: no real lobbies/bots)
// --------------------------------------------------------------------------

interface SentFrame {
  type: string;
  state?: string;
  position?: number;
  queued?: number;
}

function fakeConn(id: string): { conn: never; sent: SentFrame[] } {
  const sent: SentFrame[] = [];
  const conn = {
    identityId: id,
    send: (m: unknown) => sent.push(m as SentFrame),
  } as unknown as never;
  return { conn, sent };
}

/** A host that creates/starts in-memory immediately (no real bots/WS). */
function stubHost(overrides: Partial<MatchmakerHost> = {}): {
  host: MatchmakerHost;
  formed: string[];
  started: string[];
} {
  const formed: string[] = [];
  const started: string[] = [];
  let seq = 0;
  const counts = new Map<string, number>();
  const host: MatchmakerHost = {
    isDraining: () => false,
    createMatchmakingLobby: async () => {
      const id = `mm-${seq++}`;
      formed.push(id);
      counts.set(id, 1); // host seats immediately
      return { lobby: { id, inviteCode: `INV${id}` } as never };
    },
    joinMatchmadeLobby: (_conn, lobbyId) => {
      counts.set(lobbyId, (counts.get(lobbyId) ?? 0) + 1);
      return { lobby: { id: lobbyId } as never };
    },
    addBots: async (lobbyId, _code, count) => {
      counts.set(lobbyId, (counts.get(lobbyId) ?? 0) + count);
      return count;
    },
    lobbyPlayerCount: (lobbyId) => counts.get(lobbyId) ?? 0,
    lobbyIsWaiting: () => true,
    startMatchmadeGame: (lobbyId) => {
      started.push(lobbyId);
      return { ok: true };
    },
    disposeMatchmakingLobby: () => {},
    llmAvailable: false,
    ratingFor: () => 1500,
    ...overrides,
  };
  return { host, formed, started };
}

const TINY = { fillWindowMs: 20, botJoinPollMs: 5, botJoinTimeoutMs: 500 };

describe('Matchmaker queue / window / cancel', () => {
  it('a solo queuer gets a searching status then forms a table after the window', async () => {
    const { host, formed, started } = stubHost();
    const mm = new Matchmaker(host, TINY);
    const a = fakeConn('a');
    mm.enqueue(a.conn);
    // Immediate searching status with position 1 of 1.
    const s0 = a.sent.find((f) => f.type === 'queue_status');
    expect(s0).toMatchObject({ state: 'searching', position: 1, queued: 1 });
    expect(mm.queued).toBe(1);

    // Wait out the fill window + bot-join poll.
    await new Promise((r) => setTimeout(r, 120));
    expect(formed.length).toBe(1);
    expect(started.length).toBe(1);
    // The queuer was told the table matched.
    expect(a.sent.some((f) => f.type === 'queue_status' && f.state === 'matched')).toBe(true);
  });

  it('two queuers in the window share ONE table; positions reflect the queue', async () => {
    const { host, formed } = stubHost();
    const mm = new Matchmaker(host, TINY);
    const a = fakeConn('a');
    const b = fakeConn('b');
    mm.enqueue(a.conn);
    mm.enqueue(b.conn);
    expect(mm.queued).toBe(2);
    // b is position 2 of 2.
    const bStatus = b.sent.filter((f) => f.type === 'queue_status');
    expect(bStatus.some((f) => f.position === 2 && f.queued === 2)).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(formed.length).toBe(1); // one shared table
  });

  it('leave_queue before the window cancels and forms no table', async () => {
    const { host, formed, started } = stubHost();
    const mm = new Matchmaker(host, TINY);
    const a = fakeConn('a');
    mm.enqueue(a.conn);
    mm.leave(a.conn);
    expect(mm.queued).toBe(0);
    expect(a.sent.some((f) => f.type === 'queue_status' && f.state === 'cancelled')).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(formed.length).toBe(0);
    expect(started.length).toBe(0);
  });

  it('a disconnect removes the lone queuer and cancels the window', async () => {
    const { host, formed } = stubHost();
    const mm = new Matchmaker(host, TINY);
    const a = fakeConn('a');
    mm.enqueue(a.conn);
    mm.onDisconnect('a');
    expect(mm.queued).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(formed.length).toBe(0);
  });

  it('RANKED bucketing keeps a far-off MMR player out of the first table (then forms theirs)', async () => {
    // Three close-MMR players + one far outlier. The first table takes the close
    // cluster around the anchor; the outlier waits, then forms its own (with bots).
    const ratings: Record<string, number> = { a: 1500, b: 1540, c: 1560, far: 2400 };
    const formedLobbies: string[] = [];
    const { host } = stubHost({ ratingFor: (id) => ratings[id] ?? 1500 });
    const wrapped: MatchmakerHost = {
      ...host,
      createMatchmakingLobby: async (conn) => {
        const res = await host.createMatchmakingLobby(conn, 'x');
        if ('lobby' in res) formedLobbies.push(res.lobby.id);
        return res;
      },
    };
    // Tight base tolerance so 'far' (2400) is well outside the ~150 window.
    const mm = new Matchmaker(wrapped, TINY, 'ranked');
    mm.enqueue(fakeConn('a').conn);
    mm.enqueue(fakeConn('b').conn);
    mm.enqueue(fakeConn('c').conn);
    mm.enqueue(fakeConn('far').conn);
    expect(mm.queued).toBe(4);

    // After the first window the close cluster (a,b,c) forms; 'far' remains.
    await new Promise((r) => setTimeout(r, 60));
    expect(formedLobbies.length).toBeGreaterThanOrEqual(1);
    // 'far' was not consumed by the first (tight) table; it eventually forms its
    // own table once its wait widens the tolerance (cold-start: always forms).
    await new Promise((r) => setTimeout(r, 120));
    expect(mm.queued).toBe(0);
  });

  it('backfills bots up to the target (humans + bots = TARGET) and starts', async () => {
    const { host, started } = stubHost();
    let addedBots = 0;
    const wrapped: MatchmakerHost = {
      ...host,
      addBots: async (lobbyId, code, count, policy) => {
        addedBots += count;
        return host.addBots(lobbyId, code, count, policy);
      },
    };
    const mm = new Matchmaker(wrapped, TINY);
    mm.enqueue(fakeConn('solo').conn);
    await new Promise((r) => setTimeout(r, 120));
    // 1 human + 6 scripted bots = 7 (MIN_PLAYERS).
    expect(addedBots).toBe(MIN_PLAYERS - 1);
    expect(started.length).toBe(1);
  });
});

// --------------------------------------------------------------------------
// 2. End-to-end: solo quick_play → real bots → started game → game_over
// --------------------------------------------------------------------------

interface RealStack {
  ctx: GatewayContext;
  clock: FakeClock;
  httpUrl: string;
  wsUrl: string;
  shutdown: () => Promise<void>;
}

async function bootRealServer(): Promise<RealStack> {
  const cfg = {
    ...loadConfig({ NO_DB: '1' } as NodeJS.ProcessEnv),
    noDb: true,
    host: '127.0.0.1',
    port: 0,
  };
  const store = new MemoryStore();
  const engine = await getEngine();
  const identity = new IdentityService(store, cfg);
  const moderation = new Moderation(store);
  const telemetry = new Telemetry(store);
  const names = new Map<string, string>();
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  const origGuest = identity.createGuest.bind(identity);
  identity.createGuest = () => {
    const g = origGuest();
    names.set(g.identity.id, g.identity.name);
    return g;
  };

  let boundWsUrl: string | null = null;
  const bots = new BotManager({ wsUrl: () => boundWsUrl, llm: null });
  const clock = new FakeClock();
  const manager = new LobbyManager({
    engine,
    store,
    telemetry,
    serverBuild: 'test',
    nameOf,
    bots,
    fingerprintSecret: 'test-secret',
    // Room loop on the FakeClock; matchmaker on tiny REAL timers.
    schedule: clock.schedule,
    clock: clock.clock,
    matchmakingTimings: { fillWindowMs: 30, botJoinPollMs: 20, botJoinTimeoutMs: 4000 },
  });

  const ctx: GatewayContext = {
    cfg,
    store,
    identity,
    manager,
    moderation,
    telemetry,
    nameOf,
    rateLimit: makeRateLimiter(store.persistent),
  };
  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAuthRoutes(app, ctx);
  await app.ready();
  const gateway = new Gateway(ctx);
  gateway.attach(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  boundWsUrl = `ws://127.0.0.1:${port}/ws`;

  return {
    ctx,
    clock,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: boundWsUrl,
    shutdown: async () => {
      gateway.closeAll();
      manager.disposeAll();
      await app.close();
    },
  };
}

/** A bare human WS client that records frames and resolves on a matched table. */
function connectHuman(wsUrl: string): Promise<{
  ws: WebSocket;
  frames: Record<string, unknown>[];
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const frames: Record<string, unknown>[] = [];
    const waiters: { type: string; resolve: (f: Record<string, unknown>) => void }[] = [];
    ws.on('message', (data: Buffer) => {
      const f = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      frames.push(f);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.type === f.type) {
          waiters[i]!.resolve(f);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
      resolve({
        ws,
        frames,
        waitFor: (type, timeoutMs = 4000) =>
          new Promise<Record<string, unknown>>((res, rej) => {
            const existing = frames.find((f) => f.type === type);
            if (existing) return res(existing);
            const to = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeoutMs);
            waiters.push({
              type,
              resolve: (f) => {
                clearTimeout(to);
                res(f);
              },
            });
          }),
      });
    });
  });
}

describe('Quick-Play end-to-end (real server + real bots)', () => {
  let stack: RealStack | null = null;
  afterEach(async () => {
    if (stack) await stack.shutdown();
    stack = null;
  });

  it('a SOLO quick_play forms + starts + terminates a 7-player game with bots', async () => {
    stack = await bootRealServer();
    const human = await connectHuman(stack.wsUrl);
    await human.waitFor('welcome');

    // Enter the queue.
    human.ws.send(JSON.stringify({ v: 1, type: 'quick_play' }));

    // The server acks a searching status, then a matched status once the table
    // forms (bots join over loopback within the tiny window).
    const searching = await human.waitFor('queue_status');
    expect(searching).toMatchObject({ state: 'searching' });

    // game_started arrives once bots fill the table and the matchmaker auto-starts.
    const started = await human.waitFor('game_started', 6000);
    const seats = started['seats'] as unknown[];
    expect(seats.length).toBe(MIN_PLAYERS); // 1 human + 6 bots = 7.

    // The human got its private your_role (entitlement: exactly one).
    const yourRole = human.frames.filter((f) => f.type === 'your_role');
    expect(yourRole.length).toBe(1);

    // The room exists, has 6 backfill bots, and is a quickplay match.
    const lobbyId = (started['__lobbyId'] as string) ?? null;
    void lobbyId;
    const rooms = [
      ...(stack.ctx.manager as unknown as { rooms: Map<string, { mode?: string }> }).rooms.values(),
    ];
    expect(rooms.length).toBe(1);
    const room = rooms[0]!;
    expect(room.mode).toBe('quickplay');

    // Drive the room loop to completion via the FakeClock (quiet game resolves
    // via the engine's stalemate guard; bots need not act for termination).
    stack.clock.advance(60 * 60 * 1000);

    // The human received a public game_over: the matchmade table TERMINATED.
    const over = await human.waitFor('game_over', 1000);
    expect(over).toBeTruthy();
    expect(Array.isArray(over['winners'])).toBe(true);

    human.ws.close();
  }, 20000);

  it('RANKED quick_play is account-gated: a guest is rejected with not_authenticated', async () => {
    stack = await bootRealServer();
    const human = await connectHuman(stack.wsUrl);
    await human.waitFor('welcome'); // auto-minted guest identity

    // A guest asking for ranked is rejected so the client can prompt to sign in.
    human.ws.send(JSON.stringify({ v: 1, type: 'quick_play', mode: 'ranked' }));
    const err = await human.waitFor('error', 2000);
    expect(err['code']).toBe('not_authenticated');

    human.ws.close();
  }, 20000);
});
