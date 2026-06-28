/**
 * /healthz observability-depth checks (deferred-tail wave).
 *
 * Bare `/healthz` is a cheap liveness probe: the original fields (ok, game,
 * draining, persistent) for backward-compat, plus uptimeSec + serverBuild. The
 * DB readiness block is gated behind `?deep=1` and is best-effort — a poolStats
 * failure must yield `db.ok:false`, never throw / 500 the endpoint. Under the
 * NO_DB MemoryStore poolStats() returns null, so `db` is null even when deep.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { GAME_NAME } from '@nocturne/shared';
import { buildTestContext } from './helpers.js';
import { registerPublicRoutes } from '../http/public-routes.js';

async function buildApp() {
  const { ctx, store } = buildTestContext();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerPublicRoutes(app, ctx);
  await app.ready();
  return { app, ctx, store };
}

describe('GET /healthz — bare liveness shape', () => {
  it('keeps the original fields + adds uptimeSec/serverBuild (no db block)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Backward-compat fields unchanged.
    expect(body.ok).toBe(true);
    expect(body.game).toBe(GAME_NAME);
    expect(body.draining).toBe(false);
    expect(body.persistent).toBe(false);
    // New, non-sensitive observability fields.
    expect(typeof body.uptimeSec).toBe('number');
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    // Reflects cfg.serverBuild (the test config's loadConfig default, 'dev').
    expect(body.serverBuild).toBe('dev');
    // The DB block is gated behind ?deep=1 → absent on the bare probe.
    expect('db' in body).toBe(false);
    await app.close();
  });
});

describe('GET /healthz?deep=1 — readiness block', () => {
  it('returns db:null under the non-persistent MemoryStore (poolStats → null)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // Reflects cfg.serverBuild (the test config's loadConfig default, 'dev').
    expect(body.serverBuild).toBe('dev');
    // MemoryStore has no pool → db is explicitly null (still present).
    expect('db' in body).toBe(true);
    expect(body.db).toBeNull();
    await app.close();
  });

  it('surfaces the pg-pool shape when poolStats reports stats', async () => {
    const { app, ctx } = await buildApp();
    // Stub a persistent-store poolStats returning a healthy snapshot.
    ctx.store.poolStats = async () => ({ ok: true, total: 4, idle: 3, waiting: 0 });
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { db: { ok: boolean; total: number; idle: number; waiting: number } };
    expect(body.db).toEqual({ ok: true, total: 4, idle: 3, waiting: 0 });
    await app.close();
  });

  it('a poolStats failure yields db.ok:false and never 500s the endpoint', async () => {
    const { app, ctx } = await buildApp();
    // A pg-store style failure: poolStats itself swallows the query error and
    // reports ok:false. The endpoint must surface that, not throw.
    ctx.store.poolStats = async () => ({ ok: false, total: 2, idle: 0, waiting: 1 });
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; db: { ok: boolean } };
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(false);
    await app.close();
  });

  it('even a THROWN poolStats is caught → db.ok:false, status 200', async () => {
    const { app, ctx } = await buildApp();
    ctx.store.poolStats = async () => {
      throw new Error('pool exploded');
    };
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; db: { ok: boolean } | null };
    expect(body.ok).toBe(true);
    expect(body.db).toEqual({ ok: false, total: 0, idle: 0, waiting: 0 });
    await app.close();
  });

  it('includes this instanceId + the live-instance count (horizontal scaling)', async () => {
    const { app, ctx } = await buildApp();
    // Stub two live instances so the count reflects the shared registry.
    ctx.store.listLiveInstances = async () => [
      { id: 'inst-1', host: 'h', version: 'dev', startedAt: 1, lastHeartbeatAt: 2 },
      { id: 'inst-2', host: 'h', version: 'dev', startedAt: 1, lastHeartbeatAt: 2 },
    ];
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { instanceId: string; instances: number };
    // The test config generates an inst-<uuid> id.
    expect(typeof body.instanceId).toBe('string');
    expect(body.instanceId).toBe(ctx.cfg.serverInstanceId);
    expect(body.instances).toBe(2);
    await app.close();
  });

  it('a thrown listLiveInstances is caught → instances:0, never 500s', async () => {
    const { app, ctx } = await buildApp();
    ctx.store.listLiveInstances = async () => {
      throw new Error('registry exploded');
    };
    const res = await app.inject({ method: 'GET', url: '/healthz?deep=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; instances: number };
    expect(body.ok).toBe(true);
    expect(body.instances).toBe(0);
    await app.close();
  });
});
