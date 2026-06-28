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
  it('returns the seeded rooms in sort order, with moderation state', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({ method: 'GET', url: '/api/rooms' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rooms: Array<{ slug: string; kind: string; locked: boolean; slowModeSec: number }>;
    };
    expect(body.rooms.map((r) => r.slug)).toEqual(['shoutbox', 'parlor', 'strategy', 'offtopic']);
    expect(body.rooms[0]!.kind).toBe('shoutbox');
    // Moderation fields surface on the DTO; seeded rooms are open by default.
    expect(body.rooms.every((r) => r.locked === false && r.slowModeSec === 0)).toBe(true);
    await app.close();
  });

  it('reflects a moderated room (locked + slow-mode) in the DTO', async () => {
    const { app, ctx } = await buildSocialApp();
    await ctx.store.setRoomModeration('parlor', { locked: true, slowModeSec: 30 });
    const res = await app.inject({ method: 'GET', url: '/api/rooms' });
    const body = res.json() as {
      rooms: Array<{ slug: string; locked: boolean; slowModeSec: number }>;
    };
    const parlor = body.rooms.find((r) => r.slug === 'parlor')!;
    expect(parlor.locked).toBe(true);
    expect(parlor.slowModeSec).toBe(30);
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

// --- Moderation (admin lock + slow-mode) -----------------------------------
//
// The room-post happy-path requires a persistent (account) store, which NO_DB
// lacks. To exercise the enforcement at the route level we (a) stub
// `resolveToken` to return a synthetic account/admin and (b) make the
// MemoryStore look persistent so `requirePoster` does not short-circuit to 503.
// Every store method called downstream (getActiveSanctions, getRoomBySlug,
// postRoomMessage, setRoomModeration) is fully implemented by the MemoryStore.

const ADMIN = { id: 'user-admin000', name: 'Boss', isGuest: false, isAdmin: true } as const;
const MEMBER = { id: 'user-member00', name: 'Runner', isGuest: false, isAdmin: false } as const;

/** Make the MemoryStore present as persistent for the duration of a test. */
function makePersistent(ctx: { store: { persistent: boolean } }): void {
  Object.defineProperty(ctx.store, 'persistent', { value: true, configurable: true });
}

/** Stub token resolution so a given Bearer token maps to a fixed identity. */
function stubIdentity(
  ctx: { identity: { resolveToken: (t: string | undefined) => Promise<unknown> } },
  byToken: Record<string, typeof ADMIN | typeof MEMBER>,
): void {
  ctx.identity.resolveToken = async (token: string | undefined) =>
    (token && byToken[token]) || null;
}

describe('POST /api/rooms/:slug/moderate — admin gate', () => {
  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/moderate',
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('a guest (non-admin) gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/moderate',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('a non-admin account gets 403 (never learns the slug)', async () => {
    const { app, ctx } = await buildSocialApp();
    stubIdentity(ctx, { 'tok-member': MEMBER });
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/moderate',
      headers: { authorization: 'Bearer tok-member' },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('an admin can lock + set slow-mode; the change persists; unknown slug → 404', async () => {
    const { app, ctx } = await buildSocialApp();
    stubIdentity(ctx, { 'tok-admin': ADMIN });

    const ok = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/moderate',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { locked: true, slowModeSec: 15 },
    });
    expect(ok.statusCode).toBe(200);
    const room = (await ctx.store.getRoomBySlug('parlor'))!;
    expect(room.locked).toBe(true);
    expect(room.slowModeSec).toBe(15);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/rooms/no-such-room/moderate',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { locked: true },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('rejects an out-of-range slowModeSec (zod 0–3600) with 400', async () => {
    const { app, ctx } = await buildSocialApp();
    stubIdentity(ctx, { 'tok-admin': ADMIN });
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/moderate',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { slowModeSec: 99999 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/rooms/:slug/messages — moderation enforcement', () => {
  it('a locked room rejects a non-admin post (403 locked) but allows an admin', async () => {
    const { app, ctx } = await buildSocialApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-admin': ADMIN, 'tok-member': MEMBER });
    await ctx.store.setRoomModeration('parlor', { locked: true });

    const member = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/messages',
      headers: { authorization: 'Bearer tok-member' },
      payload: { body: 'let me in' },
    });
    expect(member.statusCode).toBe(403);
    expect((member.json() as { error: string }).error).toBe('locked');

    // An admin may still post in a locked room.
    const admin = await app.inject({
      method: 'POST',
      url: '/api/rooms/parlor/messages',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { body: 'house rules' },
    });
    expect(admin.statusCode).toBe(200);
    await app.close();
  });

  it('slow-mode enforces the longer cooldown for a non-admin (second post → 429 slow_down)', async () => {
    const { app, ctx } = await buildSocialApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-member': MEMBER });
    // 30s slow-mode is well above the base 1.2s cooldown.
    await ctx.store.setRoomModeration('strategy', { slowModeSec: 30 });

    const first = await app.inject({
      method: 'POST',
      url: '/api/rooms/strategy/messages',
      headers: { authorization: 'Bearer tok-member' },
      payload: { body: 'first word' },
    });
    expect(first.statusCode).toBe(200);

    // An immediate second post trips the slow-mode floor.
    const second = await app.inject({
      method: 'POST',
      url: '/api/rooms/strategy/messages',
      headers: { authorization: 'Bearer tok-member' },
      payload: { body: 'second word' },
    });
    expect(second.statusCode).toBe(429);
    expect((second.json() as { error: string }).error).toBe('slow_down');
    // Retry-After reflects the slow-mode window, not the 1.2s base.
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(1);
    await app.close();
  });

  it('an admin is exempt from slow-mode (post succeeds even with slow-mode set)', async () => {
    const { app, ctx } = await buildSocialApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-admin': ADMIN });
    await ctx.store.setRoomModeration('offtopic', { slowModeSec: 30 });

    // With slow-mode exemption, the admin's post is never blocked by the floor
    // (the per-(user,room) base anti-flood cooldown still applies underneath,
    // but a single fresh post is unaffected).
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/offtopic/messages',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { body: 'one' },
    });
    expect(res.statusCode).toBe(200);
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

describe('GET /api/users/search (social v1)', () => {
  it('returns [] for a query under 2 chars', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=a' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { users: unknown[] }).users).toEqual([]);
    await app.close();
  });

  it('returns [] in NO_DB even for a valid query (no user table)', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=cap' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { users: unknown[] }).users).toEqual([]);
    await app.close();
  });
});

describe('POST /api/blocks — write gate', () => {
  it('a guest gets 403 (account-only)', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { username: 'someone', on: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks',
      payload: { username: 'someone', on: true },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/me/blocks — read gate', () => {
  it('a guest gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/blocks',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('DELETE /api/dms/messages/:id — delete gate', () => {
  it('a guest gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/dms/messages/11111111-1111-1111-1111-111111111111',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildSocialApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/dms/messages/11111111-1111-1111-1111-111111111111',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('DELETE /api/rooms/messages/:id — delete gate', () => {
  it('a guest gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/rooms/messages/11111111-1111-1111-1111-111111111111',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /api/dms/:otherUserId/read — gate + bad id', () => {
  it('a guest gets 403', async () => {
    const { app, ctx } = await buildSocialApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/dms/11111111-1111-1111-1111-111111111111/read',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
