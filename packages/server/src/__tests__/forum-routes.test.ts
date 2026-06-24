/**
 * Forum route-level checks against a minimal Fastify app over the NO_DB
 * (guests-only) test context (Forums feature). Confirms the public reads work
 * and that the account-only write gate returns the right status codes.
 *
 * Account-gated happy-paths cannot run under NO_DB (no user table), so those are
 * covered at the store level in forum-store.test.ts.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { registerForumRoutes } from '../http/forum-routes.js';

async function buildForumApp() {
  const { ctx } = buildTestContext();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerForumRoutes(app, ctx);
  await app.ready();
  return { app, ctx };
}

describe('GET /api/forum (public index)', () => {
  it('returns the seeded categories + boards', async () => {
    const { app } = await buildForumApp();
    const res = await app.inject({ method: 'GET', url: '/api/forum' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      index: Array<{ category: { slug: string }; boards: Array<{ slug: string }> }>;
    };
    expect(body.index.map((c) => c.category.slug)).toEqual([
      'the-family',
      'the-game',
      'after-hours',
    ]);
    const boards = body.index.flatMap((c) => c.boards.map((b) => b.slug));
    expect(boards).toEqual(['announcements', 'introductions', 'strategy', 'results', 'offtopic']);
    await app.close();
  });
});

describe('GET /api/forum/boards/:slug (public read)', () => {
  it('200 on a known slug, 404 on an unknown slug', async () => {
    const { app } = await buildForumApp();
    const ok = await app.inject({ method: 'GET', url: '/api/forum/boards/strategy' });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { board: { slug: string }; threads: unknown[]; total: number };
    expect(body.board.slug).toBe('strategy');
    expect(body.threads).toEqual([]);
    expect(body.total).toBe(0);

    const missing = await app.inject({ method: 'GET', url: '/api/forum/boards/nope' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/forum/boards/:slug/threads — write gate', () => {
  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildForumApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/forum/boards/strategy/threads',
      payload: { title: 'A new topic', body: 'Some words.' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('a guest gets 403 (account-only writes)', async () => {
    const { app, ctx } = await buildForumApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/forum/boards/strategy/threads',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { title: 'A new topic', body: 'Some words.' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('posting to an unknown board is 404 (checked before auth)', async () => {
    const { app, ctx } = await buildForumApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/forum/boards/nope/threads',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { title: 'A new topic', body: 'Some words.' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/forum/threads/:id', () => {
  it('404 for an unknown thread', async () => {
    const { app } = await buildForumApp();
    const res = await app.inject({ method: 'GET', url: '/api/forum/threads/no-such-thread' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/forum/threads/:id/moderate — admin gate', () => {
  it('a guest gets 403 (admin-only)', async () => {
    const { app, ctx } = await buildForumApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/forum/threads/whatever/moderate',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('DELETE /api/forum/posts/:id — delete gate (social v1)', () => {
  it('an unauthenticated caller gets 401', async () => {
    const { app } = await buildForumApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/forum/posts/11111111-1111-1111-1111-111111111111',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('a guest gets 403 (account-only)', async () => {
    const { app, ctx } = await buildForumApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/forum/posts/11111111-1111-1111-1111-111111111111',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
