/**
 * WS handler error-path coverage (BUILD_SPEC §5.5, §9, §12.4).
 *
 * Complements the protocol fuzz test (`fuzz.test.ts`) with TARGETED assertions:
 * every malformed / out-of-context / unauthorized command must produce a clean
 * `error` frame with a sensible code, and the gateway must NEVER throw out of the
 * pipeline (a handler bug is wrapped → `internal_error`, the socket stays open).
 *
 * Everything runs through the real gateway pipeline over the NO_DB context.
 */

import { describe, it, expect, vi } from 'vitest';
import { Gateway, MAX_FRAME_BYTES } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';
import type { GatewayContext } from '../ws/context.js';
import type { Connection } from '../ws/connection.js';

async function hello(gw: Gateway, sock: FakeSocket, token?: string): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(
    conn,
    JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, ...(token ? { token } : {}) }),
  );
  return conn;
}

/** Boot a started classic-nocturne game; returns sockets + connections (seat order). */
async function startGame(
  ctx: GatewayContext,
  n: number,
): Promise<{ gw: Gateway; socks: FakeSocket[]; conns: Connection[] }> {
  const gw = new Gateway(ctx);
  const socks: FakeSocket[] = [];
  const conns: Connection[] = [];
  for (let i = 0; i < n; i++) {
    const guest = ctx.identity.createGuest();
    const s = new FakeSocket();
    socks.push(s);
    conns.push(await hello(gw, s, guest.token));
  }
  await gw.deliverForTest(
    conns[0]!,
    JSON.stringify({
      v: 1,
      type: 'create_lobby',
      name: 'L',
      visibility: 'private',
      setupId: 'classic-nocturne',
    }),
  );
  const lobbyId = ctx.manager.lobbyOf(conns[0]!)!.id;
  for (let i = 1; i < n; i++) {
    await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId }));
  }
  await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'start_game' }));
  return { gw, socks, conns };
}

// --- pre-hello + unknown type ----------------------------------------------

describe('pipeline guards', () => {
  it('a command before hello replies not_authenticated (no crash)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock); // NB: no hello
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'vote', target: 1 }));
    expect(sock.lastOfType('error')?.code).toBe('not_authenticated');
  });

  it('an unknown message type replies bad_message (rejected at the schema)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'definitely_not_a_real_type' }));
    // Unknown types fail shared zod validation before dispatch → bad_message.
    expect(sock.lastOfType('error')?.code).toBe('bad_message');
  });

  it('a malformed JSON frame replies bad_message', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(conn, '{ not: valid json ');
    expect(sock.lastOfType('error')?.code).toBe('bad_message');
  });

  it('an oversized frame replies bad_message (size cap)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 256);
    await gw.deliverForTest(
      conn,
      JSON.stringify({ v: 1, type: 'chat', channel: 'day', text: huge }),
    );
    expect(sock.lastOfType('error')?.code).toBe('bad_message');
  });
});

// --- in-game commands issued while NOT in a game ----------------------------

describe('in-game commands without a game', () => {
  it('vote outside a game → not_in_game', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'vote', target: 1 }));
    expect(sock.lastOfType('error')?.code).toBe('not_in_game');
  });

  it('night_action outside a game → not_in_game', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({ v: 1, type: 'night_action', ability: 'kill', target: 2 }),
    );
    expect(sock.lastOfType('error')?.code).toBe('not_in_game');
  });

  it('chat with no lobby and no game → not_in_lobby', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'chat', channel: 'day', text: 'hi' }));
    expect(sock.lastOfType('error')?.code).toBe('not_in_lobby');
  });

  it('whisper outside a game → not_in_game', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({ v: 1, type: 'whisper', toSeat: 1, text: 'psst' }),
    );
    expect(sock.lastOfType('error')?.code).toBe('not_in_game');
  });
});

// --- host-only commands from a non-host -------------------------------------

describe('host-only commands from a non-host', () => {
  /** Two guests in a waiting lobby; index 1 is a non-host member. */
  async function twoInLobby() {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const host = await hello(gw, new FakeSocket(), ctx.identity.createGuest().token);
    const memberSock = new FakeSocket();
    const member = await hello(gw, memberSock, ctx.identity.createGuest().token);
    await gw.deliverForTest(
      host,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'L',
        visibility: 'private',
        setupId: 'classic-nocturne',
      }),
    );
    const lobbyId = ctx.manager.lobbyOf(host)!.id;
    await gw.deliverForTest(member, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId }));
    memberSock.sent.length = 0;
    return { gw, member, memberSock };
  }

  it('start_game from a non-host → not_host', async () => {
    const { gw, member, memberSock } = await twoInLobby();
    await gw.deliverForTest(member, JSON.stringify({ v: 1, type: 'start_game' }));
    expect(memberSock.lastOfType('error')?.code).toBe('not_host');
  });

  it('lobby_config from a non-host → not_host', async () => {
    const { gw, member, memberSock } = await twoInLobby();
    await gw.deliverForTest(
      member,
      JSON.stringify({ v: 1, type: 'lobby_config', config: { whispersEnabled: false } }),
    );
    expect(memberSock.lastOfType('error')?.code).toBe('not_host');
  });

  it('kick from a non-host → not_host', async () => {
    const { gw, member, memberSock } = await twoInLobby();
    await gw.deliverForTest(member, JSON.stringify({ v: 1, type: 'kick', seatOrUserId: 'someone' }));
    expect(memberSock.lastOfType('error')?.code).toBe('not_host');
  });
});

// --- bad / dead seats in a started game -------------------------------------

describe('in-game seat-validity guards', () => {
  it('whisper to a non-existent seat → illegal_target (no crash)', async () => {
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'whisper', toSeat: 99, text: 'nobody home' }),
    );
    expect(socks[0]!.lastOfType('error')?.code).toBe('illegal_target');
  });

  it('a vote from a DEAD seat → seat_dead', async () => {
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    const actor = conns[1]!;
    const room = ctx.manager.roomOf(actor)!;
    const seat = room.seatForIdentity(actor.identityId!)!;
    // Force this seat to read as dead so the §5.5 dead-seat guard fires
    // deterministically (the simplified engine kills no one on its own here).
    vi.spyOn(room, 'deadSeats').mockReturnValue([seat]);
    socks[1]!.sent.length = 0;
    await gw.deliverForTest(actor, JSON.stringify({ v: 1, type: 'vote', target: 2 }));
    expect(socks[1]!.lastOfType('error')?.code).toBe('seat_dead');
  });

  it('a night_action from a DEAD seat → seat_dead', async () => {
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    const actor = conns[2]!;
    const room = ctx.manager.roomOf(actor)!;
    const seat = room.seatForIdentity(actor.identityId!)!;
    vi.spyOn(room, 'deadSeats').mockReturnValue([seat]);
    socks[2]!.sent.length = 0;
    await gw.deliverForTest(
      actor,
      JSON.stringify({ v: 1, type: 'night_action', ability: 'kill', target: 1 }),
    );
    expect(socks[2]!.lastOfType('error')?.code).toBe('seat_dead');
  });
});

// --- the gateway never throws (final safety net) ----------------------------

describe('pipeline never throws', () => {
  it('a handler bug surfaces as internal_error, not a process crash', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    // Sabotage a handler dependency so dispatch throws; the gateway must catch it
    // and reply internal_error rather than propagate.
    vi.spyOn(ctx.manager, 'lobbyOf').mockImplementation(() => {
      throw new Error('boom');
    });
    sock.sent.length = 0;
    await expect(
      gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'chat', channel: 'lobby', text: 'x' })),
    ).resolves.toBeUndefined();
    expect(sock.lastOfType('error')?.code).toBe('internal_error');
  });
});
