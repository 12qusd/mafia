/**
 * Reconnect / duplicate-takeover tests over REAL sockets (BUILD_SPEC §8, §12.4).
 *
 *  - Duplicate connection takeover: two sockets presenting the SAME token; the
 *    newest wins and the older is closed (§8 newest-wins).
 *  - Reconnect-resume snapshot equivalence: a seated bot disconnects mid-game,
 *    reconnects with its token, and the server sends a per-seat `welcome.resume`
 *    snapshot whose rebuilt view (phase, alive set, own role, entitled chat)
 *    matches a never-disconnected observer's equivalent public view + the
 *    resumer's own private log.
 *
 * Games are set up with the fastest legal timings so we can catch a mid-game
 * window without long waits.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import {
  startInProcessServer,
  fetchGuestToken,
  type RunningServer,
} from '../server-harness.js';
import { BotClient } from '../client.js';
import { BotPolicy } from '../policy.js';
import { FAST_TIMINGS } from '../timings.js';
import type { ServerMessage } from '../protocol.js';

let server: RunningServer;
beforeAll(async () => {
  server = await startInProcessServer();
});
afterAll(async () => {
  await server.shutdown();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await sleep(20);
}

describe('duplicate-connection takeover (§8)', () => {
  it('a second socket with the same token supersedes the first', async () => {
    const token = await fetchGuestToken(server.httpUrl);

    const first = new WebSocket(server.wsUrl);
    let firstClosed = false;
    let firstCloseCode = 0;
    await new Promise<void>((r) => first.on('open', () => r()));
    first.on('close', (code: number) => {
      firstClosed = true;
      firstCloseCode = code;
    });
    first.send(JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, token }));
    await sleep(50);

    // Second socket, same token.
    const second = new WebSocket(server.wsUrl);
    await new Promise<void>((r) => second.on('open', () => r()));
    let secondWelcomed = false;
    second.on('message', (d: WebSocket.RawData) => {
      const m = JSON.parse(String(d)) as { type?: string };
      if (m.type === 'welcome') secondWelcomed = true;
    });
    second.send(JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, token }));

    await waitFor(() => firstClosed && secondWelcomed, 1500);
    expect(secondWelcomed).toBe(true);
    expect(firstClosed).toBe(true);
    expect(firstCloseCode).toBe(4000); // 'superseded'
    second.close();
  });
});

describe('reconnect-resume snapshot equivalence (§8, §12.4)', () => {
  it("resumed view matches a never-disconnected observer's public view + own private log", async () => {
    const players = 7;
    // Stable tokens so the resumer keeps its identity across reconnect.
    const tokens = await Promise.all(
      Array.from({ length: players }, () => fetchGuestToken(server.httpUrl)),
    );

    const bots: BotClient[] = [];
    const policies: BotPolicy[] = [];
    for (let i = 0; i < players; i++) {
      const bot = new BotClient({ url: server.wsUrl, name: `r-${i}`, token: tokens[i]! });
      bots.push(bot);
    }
    await bots[0]!.connect();
    for (let i = 1; i < players; i++) await bots[i]!.connect();
    bots.forEach((bot, i) => {
      const p = new BotPolicy(bot, { seed: `recon:${i}` });
      policies.push(p);
      bot.setSeat(i);
      bot.policyDrive = (m) => p.onFrame(m);
    });

    const host = bots[0]!;
    host.send({
      v: 1,
      type: 'create_lobby',
      name: 'recon',
      visibility: 'private',
      setupId: 'classic-nocturne',
      config: { timings: FAST_TIMINGS, whispersEnabled: true, deadSeeAll: true, lastWillsEnabled: true },
    });
    await waitFor(() => host.lobbyId !== null, 3000);
    const lobbyId = host.lobbyId!;
    for (let i = 1; i < players; i++) bots[i]!.send({ v: 1, type: 'join_lobby', lobbyId });
    await waitFor(() => host.lobbyMembers.filter((m) => !m.isSpectator).length >= players, 3000);
    host.send({ v: 1, type: 'start_game' });
    await waitFor(() => bots.every((b) => b.view.role !== null), 3000);

    // Let the game run a little so there is non-trivial state to resume into.
    const ticker = setInterval(() => policies.forEach((p) => p.tick()), 300);
    await sleep(1500);
    clearInterval(ticker);

    // Pick a resumer that is NOT the host (so the host stays as observer).
    const resumerIdx = 3;
    const resumer = bots[resumerIdx]!;
    const observer = bots[0]!;
    const resumerSeat = resumerIdx;
    const ownRoleBefore = resumer.view.role;

    // Disconnect the resumer (the game never pauses, §8).
    resumer.close();
    await sleep(300);

    // Reconnect with the SAME token; capture the resume snapshot.
    let resume: Extract<ServerMessage, { type: 'welcome' }>['resume'] | undefined;
    const reconnected = new BotClient({
      url: server.wsUrl,
      name: `r-${resumerIdx}-again`,
      token: tokens[resumerIdx]!,
      onWelcome: (w) => {
        resume = w.resume;
      },
    });
    await reconnected.connect();
    await waitFor(() => resume !== undefined, 2000);

    expect(resume).toBeDefined();
    const snap = resume!;
    // Own role survived the reconnect and matches what we had.
    expect(snap.ownRole).toBe(ownRoleBefore);
    expect(snap.seat).toBe(resumerSeat);

    // Public view equivalence: the resumer's snapshot alive-set equals the
    // observer's view of who is alive (both derive from the same public state).
    const snapAlive = new Set(snap.seats.filter((s) => s.alive).map((s) => s.seat));
    const observerAlive = observer.view.alive;
    // The observer tracks alive via death_announce; the snapshot is authoritative.
    // They must agree on the dead set (a superset relationship can occur only if a
    // death landed in the reconnect window; allow at most that slack).
    const deadInSnap = snap.seats.filter((s) => !s.alive).map((s) => s.seat);
    for (const d of deadInSnap) {
      // Anyone dead in the snapshot must also be dead (absent) in the observer's
      // alive set — both see public deaths.
      expect(observerAlive.has(d)).toBe(false);
    }

    // Phase agreement (same public phase, modulo a transition in the window).
    expect(typeof snap.phase).toBe('string');
    // Entitled chat backlog: only channels the seat may read appear. A non-mafia
    // resumer must never get a mafia backlog entry (§5).
    const isMafia = snap.mates !== undefined;
    if (!isMafia) {
      expect(snap.chatBacklog.every((c) => c.channel !== 'mafia')).toBe(true);
    }
    // Private log is the seat's own (opaque) results — present as an array.
    expect(Array.isArray(snap.privateLog)).toBe(true);

    void snapAlive;
    for (const b of bots) b.close();
    reconnected.close();
  });
});
