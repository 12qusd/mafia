/**
 * TEST MODE tests (NOCTURNE test mode): gating, god-view delivery, end_phase,
 * and the §5 invariant that NORMAL games never emit debug_* frames while a
 * test-mode game emits them ONLY to the host.
 *
 * These run against the real engine when present; the god-view derives from
 * engine state (debug_state/debug_trace), so the in-server fallback supplies a
 * best-effort subset. The gating + delivery-isolation assertions hold either way.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getEngine, isUsingFallbackEngine } from '../engine-adapter.js';
import { Gateway } from '../ws/gateway.js';
import type { GatewayContext } from '../ws/context.js';
import { buildTestContext, FakeSocket, FakeClock } from './helpers.js';
import type { Connection } from '../ws/connection.js';

let fallback = true;
beforeAll(async () => {
  await getEngine();
  fallback = isUsingFallbackEngine();
});

async function hello(gw: Gateway, sock: FakeSocket, token?: string): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(
    conn,
    JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, ...(token ? { token } : {}) }),
  );
  return conn;
}

/** Build a test context whose env gate is open (NOCTURNE_TEST_MODE=1). */
function testModeCtx(clock?: FakeClock): { ctx: GatewayContext } {
  const built = buildTestContext({ testModeEnv: true, ...(clock ? { clock } : {}) });
  return { ctx: built.ctx };
}

/** Seat N guests, host creates a (test or normal) lobby, others join, host starts. */
async function startGame(
  ctx: GatewayContext,
  n: number,
  opts: { testMode?: boolean } = {},
): Promise<{ gw: Gateway; socks: FakeSocket[]; conns: Connection[]; tokens: string[]; lobbyId: string }> {
  const gw = new Gateway(ctx);
  const socks: FakeSocket[] = [];
  const conns: Connection[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) {
    const guest = ctx.identity.createGuest();
    tokens.push(guest.token);
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
      ...(opts.testMode ? { config: { testMode: true } } : {}),
    }),
  );
  const lobby = ctx.manager.lobbyOf(conns[0]!)!;
  for (let i = 1; i < n; i++) {
    await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId: lobby.id }));
  }
  await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'start_game' }));
  return { gw, socks, conns, tokens, lobbyId: lobby.id };
}

describe('test-mode gating (§5 still law for normal games)', () => {
  it('rejects testMode without env gate / admin', async () => {
    const { ctx } = buildTestContext(); // env gate CLOSED
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'L',
        visibility: 'private',
        setupId: 'classic-nocturne',
        config: { testMode: true },
      }),
    );
    expect(sock.lastOfType('error')).toMatchObject({ code: 'forbidden' });
    expect(sock.lastOfType('lobby_state')).toBeUndefined();
  });

  it('accepts testMode when the env gate is open; lobby is private + TEST-badged', async () => {
    const { ctx } = testModeCtx();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'L',
        visibility: 'public', // forced to private by test mode
        setupId: 'classic-nocturne',
        config: { testMode: true },
      }),
    );
    const ls = sock.lastOfType('lobby_state') as { lobby: { testMode?: boolean; visibility: string } };
    expect(ls).toBeTruthy();
    expect(ls.lobby.testMode).toBe(true);
    expect(ls.lobby.visibility).toBe('private');
  });
});

describe('god-view delivery (host only)', () => {
  it('host receives debug_state at game start; non-host players receive none', async () => {
    const { ctx } = testModeCtx();
    const { socks } = await startGame(ctx, 7, { testMode: true });
    // Host is seat/index 0 (the god audience).
    expect(socks[0]!.ofType('debug_state').length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < socks.length; i++) {
      expect(socks[i]!.ofType('debug_state').length).toBe(0);
      expect(socks[i]!.ofType('debug_trace').length).toBe(0);
      expect(socks[i]!.ofType('debug_event').length).toBe(0);
    }
  });

  it('host receives a fresh debug_state on every phase_change', async () => {
    const clock = new FakeClock();
    const { ctx } = testModeCtx(clock);
    const { socks } = await startGame(ctx, 7, { testMode: true });
    const before = socks[0]!.ofType('debug_state').length;
    clock.advance(120 * 1000); // drive a couple of phase transitions
    expect(socks[0]!.ofType('debug_state').length).toBeGreaterThan(before);
    // debug_event mirrors validated GameEvents (at least phase_end fired).
    expect(socks[0]!.ofType('debug_event').length).toBeGreaterThan(0);
  });

  it('NORMAL (non-test) game emits NO debug_* frames to anyone', async () => {
    const clock = new FakeClock();
    const { ctx } = testModeCtx(clock); // env open, but lobby is NOT test mode
    const { socks } = await startGame(ctx, 7, { testMode: false });
    clock.advance(60 * 60 * 1000); // run to game_over
    for (const s of socks) {
      expect(s.ofType('debug_state').length).toBe(0);
      expect(s.ofType('debug_trace').length).toBe(0);
      expect(s.ofType('debug_event').length).toBe(0);
    }
  });

  it('a test-mode game to game_over emits debug_trace ONLY to the host', async () => {
    if (fallback) {
      // The fallback engine produces no structured ResolutionTraces; debug_trace
      // records still fire but carry an empty trace array. The host-only
      // delivery isolation still holds and is asserted here.
      console.warn('note: fallback engine — debug_trace arrays are empty');
    }
    const clock = new FakeClock();
    const { ctx } = testModeCtx(clock);
    const { socks } = await startGame(ctx, 7, { testMode: true });
    clock.advance(60 * 60 * 1000);
    // Only the host (index 0) ever saw debug_trace frames.
    for (let i = 1; i < socks.length; i++) {
      expect(socks[i]!.ofType('debug_trace').length).toBe(0);
    }
    expect(socks[0]!.ofType('debug_trace').length).toBeGreaterThanOrEqual(1);
  });
});

describe('test_control end_phase', () => {
  it('advances the game immediately without waiting out the timer', async () => {
    const clock = new FakeClock();
    const { ctx } = testModeCtx(clock);
    const { gw, conns, socks } = await startGame(ctx, 7, { testMode: true });
    // We are in DAY_0; capture the current phase from the host's last debug_state.
    const phase0 = (socks[0]!.lastOfType('debug_state') as { phase: string } | undefined)?.phase;
    const beforeStates = socks[0]!.ofType('debug_state').length;
    // Host issues end_phase — should fire phase_end now (no clock advance).
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'test_control', action: 'end_phase' }));
    // A new debug_state (phase changed) arrived for the host without advancing time.
    expect(socks[0]!.ofType('debug_state').length).toBeGreaterThan(beforeStates);
    const phase1 = (socks[0]!.lastOfType('debug_state') as { phase: string }).phase;
    expect(phase1).not.toBe(phase0);
  });

  it('rejects test_control from a non-host', async () => {
    const { ctx } = testModeCtx();
    const { gw, conns, socks } = await startGame(ctx, 7, { testMode: true });
    await gw.deliverForTest(conns[3]!, JSON.stringify({ v: 1, type: 'test_control', action: 'end_phase' }));
    expect(socks[3]!.lastOfType('error')).toMatchObject({ code: 'not_host' });
  });

  it('request_state resends a debug_state to the host', async () => {
    const { ctx } = testModeCtx();
    const { gw, conns, socks } = await startGame(ctx, 7, { testMode: true });
    const before = socks[0]!.ofType('debug_state').length;
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'test_control', action: 'request_state' }));
    expect(socks[0]!.ofType('debug_state').length).toBe(before + 1);
  });
});
