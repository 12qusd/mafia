/**
 * Social route-level checks against a minimal Fastify app over the NO_DB
 * (guests-only) test context (Social feature). Confirms the public reads work
 * and that the account-only write gate returns the right status codes.
 *
 * Account-gated happy-paths cannot run under NO_DB (no user table), so those are
 * covered at the store level in social-store.test.ts.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { registerSocialRoutes } from '../http/social-routes.js';

async function buildSocialApp() {
  const { ctx } = buildTestContext();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerSocialRoutes(app, ctx);
  await app.ready();
  return { app, ctx };
}

describe('GET /api/rooms (public)', () => {
  it('returns the seeded rooms in sort order', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({ method: 'GET', url: '/api/rooms' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rooms: Array<{ slug: string; kind: string }> };
    expect(body.rooms.map((r) => r.slug)).toEqual(['shoutbox', 'parlor', 'strategy', 'offtopic']);
    expect(body.rooms[0]!.kind).toBe('shoutbox');
    await app.close();
  });
});

describe('GET /api/rooms/:slug/messages (public read)', () => {
  it('200 on a known slug, 404 on an unknown slug', async () => {
    const { app } = await buildSocialApp();
    const ok = await app.inject({ method: 'GET', url: '/api/rooms/parlor/messages' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { messages: unknown[] }).messages).toEqual([]);

    const missing = await app.inject({ method: 'GET', url: '/api/rooms/nope/messages' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/rooms/:slug/messages — write gate', () => {
  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/shoutbox/messages',
      payload: { body: 'word on the street' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('a guest gets 403 (account-only writes)', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/shoutbox/messages',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { body: 'word on the street' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('posting to an unknown slug is 404 (checked before auth)', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/nope/messages',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { body: 'hello' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/users/:username/profile (public)', () => {
  it('404 in NO_DB (no persistent user store)', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/nobody/profile' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/me/profile — write gate', () => {
  it('a guest gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { tagline: 'hi' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
