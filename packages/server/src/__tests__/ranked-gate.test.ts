/**
 * Ranked anti-smurf gate (Wave 7b): the ranked queue is closed to accounts with
 * fewer than RANKED_MIN_GAMES finished games, surfaced as `cannot_start` +
 * `ranked_locked`. Drives the real gateway with a (stubbed) persistent store.
 */

import { describe, it, expect } from 'vitest';
import { RANKED_MIN_GAMES } from '@nocturne/shared';
import { Gateway } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';
import type { Connection } from '../ws/connection.js';

async function helloAccount(gw: Gateway, sock: FakeSocket): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
  // Promote the auto-minted guest to a registered (non-guest) account.
  if (conn.identity) conn.identity = { ...conn.identity, isGuest: false };
  return conn;
}

function lastErrorOf(sock: FakeSocket): { code?: string; detail?: string } | undefined {
  const errs = sock.ofType('error');
  return errs[errs.length - 1] as { code?: string; detail?: string } | undefined;
}

describe('ranked anti-smurf gate', () => {
  it(`rejects ranked for an account with < ${RANKED_MIN_GAMES} games (cannot_start / ranked_locked)`, async () => {
    const { ctx, store } = buildTestContext();
    // Make the store look persistent and report a brand-new account's game count.
    Object.defineProperty(store, 'persistent', { value: true, configurable: true });
    store.getUserStats = async () =>
      ({ gamesPlayed: RANKED_MIN_GAMES - 1 }) as never;
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await helloAccount(gw, sock);
    sock.sent.length = 0;
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'quick_play', mode: 'ranked' }));
    const err = lastErrorOf(sock);
    expect(err?.code).toBe('cannot_start');
    expect(err?.detail).toBe('ranked_locked');
  });

  it(`lets a seasoned account (>= ${RANKED_MIN_GAMES} games) past the smurf gate`, async () => {
    const { ctx, store } = buildTestContext();
    Object.defineProperty(store, 'persistent', { value: true, configurable: true });
    store.getUserStats = async () => ({ gamesPlayed: RANKED_MIN_GAMES }) as never;
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await helloAccount(gw, sock);
    sock.sent.length = 0;
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'quick_play', mode: 'ranked' }));
    // It gets past the smurf gate; any subsequent error (e.g. no open season in
    // the test context) is NOT the ranked_locked one.
    const err = lastErrorOf(sock);
    expect(err?.detail).not.toBe('ranked_locked');
  });

  it('does not gate CASUAL quick play (no smurf bar there)', async () => {
    const { ctx, store } = buildTestContext();
    Object.defineProperty(store, 'persistent', { value: true, configurable: true });
    store.getUserStats = async () => ({ gamesPlayed: 0 }) as never;
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await helloAccount(gw, sock);
    sock.sent.length = 0;
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'quick_play', mode: 'casual' }));
    expect(lastErrorOf(sock)?.detail).not.toBe('ranked_locked');
  });
});
