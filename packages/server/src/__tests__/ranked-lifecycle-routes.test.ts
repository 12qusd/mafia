/**
 * Ranked-lifecycle route + manager checks (ranked-progression depth).
 *
 * Routes are exercised against a minimal Fastify app over the NO_DB test context:
 * the public-read shapes (paginated leaderboard, seasons, self-rank-null) and the
 * admin-only rollover gate (403 for a non-admin; 400 not_persistent under NO_DB).
 * The leaver re-queue cooldown is a manager-level behavior tested directly over a
 * persistent-faking store (ranked needs accounts + a season).
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { MemoryStore } from '../db/memory-store.js';
import { LobbyManager } from '../lobby/manager.js';
import { Telemetry } from '../telemetry.js';
import { makeFallbackEngine } from '../engine-fallback.js';
import { Connection } from '../ws/connection.js';
import type { RawSocket } from '../ws/connection.js';
import { registerPublicRoutes } from '../http/public-routes.js';
import { registerAuthRoutes } from '../http/auth-routes.js';
import { registerAdminRoutes } from '../http/admin-routes.js';

const ADMIN_TOKEN = 'test-admin-token';

async function buildApp() {
  const { ctx, store } = buildTestContext();
  ctx.cfg.adminToken = ADMIN_TOKEN; // bootstrap admin-token path
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerPublicRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  await app.ready();
  return { app, ctx, store };
}

describe('GET /api/leaderboard/ranked (paginated)', () => {
  it('returns the paginated shape (empty under NO_DB, no season)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/leaderboard/ranked?page=0&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: unknown[];
      page: number;
      limit: number;
      total: number;
    };
    expect(body.entries).toEqual([]);
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('total');
    await app.close();
  });
});

describe('GET /api/seasons', () => {
  it('returns an empty list under NO_DB', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/seasons' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { seasons: unknown[] }).seasons).toEqual([]);
    await app.close();
  });
});

describe('GET /api/me/ranked/rank (self-rank)', () => {
  it('401 without a session', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/me/ranked/rank' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rank is null for a guest / unplaced caller', async () => {
    const { app, ctx } = await buildApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/ranked/rank',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { rank: unknown }).rank).toBeNull();
    await app.close();
  });
});

describe('GET /api/me/ranked/history', () => {
  it('returns an empty history for a guest', async () => {
    const { app, ctx } = await buildApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/ranked/history',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { history: unknown[] }).history).toEqual([]);
    await app.close();
  });
});

describe('POST /api/admin/seasons/rollover (admin-only)', () => {
  it('403 for a non-admin caller', async () => {
    const { app, ctx } = await buildApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/seasons/rollover',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('400 not_persistent under NO_DB even with the admin token', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/seasons/rollover',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { name: 'Season 2' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('not_persistent');
    await app.close();
  });
});

// --- Leaver cooldown (manager-level over a persistent-faking store) ----------

/** A MemoryStore that reports persistent=true so the ranked path is exercised. */
class PersistentMemoryStore extends MemoryStore {
  readonly persistent = true;
}

class TestSocket implements RawSocket {
  readyState = 1;
  send(): void {}
  close(): void {}
  on(): void {}
}

function buildRankedManager(clock: { now: number }) {
  const store = new PersistentMemoryStore();
  const telemetry = new Telemetry(store);
  const engine = makeFallbackEngine();
  const manager = new LobbyManager({
    engine,
    store,
    telemetry,
    serverBuild: 'test',
    nameOf: (id) => id.slice(0, 8),
    fingerprintSecret: 'secret',
    clock: () => clock.now,
  });
  return { manager, store };
}

function acct(id: string): Connection {
  const conn = new Connection(new TestSocket());
  conn.identity = { id, name: id, isGuest: false, isAdmin: false };
  return conn;
}

describe('ranked leaver cooldown', () => {
  it('blocks a recent leaver from re-queuing ranked, then expires', async () => {
    const clock = { now: 1_000_000 };
    const { manager } = buildRankedManager(clock);
    await manager.ensureSeason('Season 1');

    const user = acct('user-leaver');
    // Normally allowed to queue ranked.
    expect(manager.quickPlay(user, 'ranked')).toBeNull();
    manager.leaveQueue(user); // tidy up the queue entry

    // Simulate a game-over leaver penalty by stamping a cooldown via the public
    // queue path: re-create the condition the manager sets at game over.
    // (We reach into the documented behavior by penalizing through award flow is
    // covered elsewhere; here we assert the quickPlay gate using a set cooldown.)
    (manager as unknown as { rankedCooldownUntil: Map<string, number> }).rankedCooldownUntil.set(
      user.identity!.id,
      clock.now + 5 * 60 * 1000,
    );

    // Now re-queue is blocked with the 'cooldown' sentinel.
    expect(manager.quickPlay(user, 'ranked')).toBe('cooldown');

    // After the cooldown elapses, re-queue is allowed again (and the entry is
    // lazily pruned).
    clock.now += 5 * 60 * 1000 + 1;
    expect(manager.quickPlay(user, 'ranked')).toBeNull();
    expect(
      (manager as unknown as { rankedCooldownUntil: Map<string, number> }).rankedCooldownUntil.has(
        user.identity!.id,
      ),
    ).toBe(false);
  });
});
