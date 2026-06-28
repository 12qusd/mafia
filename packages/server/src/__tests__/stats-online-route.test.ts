/**
 * GET /api/stats/online — cluster-coherent online count.
 *
 * Back-compat: the response ALWAYS carries `online`. Under a persistent store
 * the count is the cluster-wide DB figure plus a live-instance count (so it is
 * correct across instances); under the non-persistent MemoryStore it falls back
 * to this process's local socket count via ctx.onlineCount.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
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

describe('GET /api/stats/online', () => {
  it('non-persistent store: falls back to the local socket count (online only)', async () => {
    const { app, ctx } = await buildApp();
    ctx.onlineCount = () => 3;
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.online).toBe(3); // back-compat field present
    await app.close();
  });

  it('non-persistent store with no onlineCount wired → online:0', async () => {
    const { app, ctx } = await buildApp();
    delete ctx.onlineCount;
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    const body = res.json() as Record<string, unknown>;
    expect(body.online).toBe(0);
    await app.close();
  });

  it('persistent store: returns the cluster-wide DB count + live instances', async () => {
    const { app, ctx } = await buildApp();
    // Present the store as persistent and stub the cluster surfaces.
    Object.defineProperty(ctx.store, 'persistent', { value: true, configurable: true });
    ctx.store.getOnlineCount = async () => 42;
    ctx.store.listLiveInstances = async () => [
      { id: 'a', host: 'h', version: 'v', startedAt: 1, lastHeartbeatAt: 2 },
      { id: 'b', host: 'h', version: 'v', startedAt: 1, lastHeartbeatAt: 2 },
    ];
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { online: number; instances: number };
    expect(body.online).toBe(42);
    expect(body.instances).toBe(2);
    await app.close();
  });

  it('persistent store: a failing registry/count degrades to zeros, never 500s', async () => {
    const { app, ctx } = await buildApp();
    Object.defineProperty(ctx.store, 'persistent', { value: true, configurable: true });
    ctx.store.getOnlineCount = async () => {
      throw new Error('db down');
    };
    ctx.store.listLiveInstances = async () => {
      throw new Error('db down');
    };
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { online: number; instances: number };
    expect(body.online).toBe(0);
    expect(body.instances).toBe(0);
    await app.close();
  });
});
