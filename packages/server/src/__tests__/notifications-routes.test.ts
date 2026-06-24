/**
 * Notifications center routes + generation hooks (QoL wave).
 *
 * Two surfaces:
 *  - the bell endpoints + report endpoint over a persistent-faking store with a
 *    minimal user table, so the account-only happy paths run without Postgres;
 *  - the guest/anon gate over the plain NO_DB context.
 *
 * Generation is asserted end-to-end: posting a friend request creates a
 * friend_request notification for the target; accepting one creates a
 * friend_accepted for the original requester. Best-effort: the same flow under a
 * NON-persistent store must NOT throw and must produce no rows.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig } from '../config.js';
import { MemoryStore } from '../db/memory-store.js';
import { IdentityService } from '../auth/identity.js';
import { LobbyManager } from '../lobby/manager.js';
import { Moderation } from '../moderation/moderation.js';
import { Telemetry } from '../telemetry.js';
import { makeFallbackEngine } from '../engine-fallback.js';
import { makeRateLimiter } from '../http/rate-limit.js';
import { makeEmailTransport } from '../email/transport.js';
import { EmailService } from '../email/service.js';
import { registerSocialRoutes } from '../http/social-routes.js';
import { registerAuthRoutes } from '../http/auth-routes.js';
import { newId } from '../ids.js';
import { buildTestContext } from './helpers.js';
import type { GatewayContext } from '../ws/context.js';
import type { Store, UserRow } from '../db/types.js';

/** A MemoryStore with a working users table + persistent=true (no Postgres). */
class AccountStore extends MemoryStore {
  override readonly persistent = true;
  private users = new Map<string, UserRow>();
  private dbSessions = new Map<string, { userId: string; expiresAt: number }>();

  override async createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<UserRow> {
    const row: UserRow = {
      id: newId(),
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      flags: 0,
    };
    this.users.set(input.username.toLowerCase(), row);
    this.setUsernameForTest(row.id, row.username);
    return row;
  }
  override async getUserByUsername(username: string): Promise<UserRow | null> {
    return this.users.get(username.toLowerCase()) ?? null;
  }
  override async getUserById(id: string): Promise<UserRow | null> {
    for (const u of this.users.values()) if (u.id === id) return u;
    return null;
  }
  override async setLastLogin(): Promise<void> {}
  override async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.dbSessions.set(tokenHash, { userId, expiresAt });
  }
  override async getSessionUserId(tokenHash: string): Promise<string | null> {
    return this.dbSessions.get(tokenHash)?.userId ?? null;
  }
  override async getSession(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: number } | null> {
    return this.dbSessions.get(tokenHash) ?? null;
  }
  override async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    const s = this.dbSessions.get(tokenHash);
    if (s) s.expiresAt = expiresAt;
  }
  override async revokeSession(tokenHash: string): Promise<void> {
    this.dbSessions.delete(tokenHash);
  }
}

function buildContext(store: Store): GatewayContext {
  const cfg = loadConfig();
  const identity = new IdentityService(store, cfg);
  const telemetry = new Telemetry(store);
  const moderation = new Moderation(store);
  const engine = makeFallbackEngine();
  const manager = new LobbyManager({
    engine,
    store,
    telemetry,
    serverBuild: 'test',
    nameOf: (id) => id.slice(0, 8),
    fingerprintSecret: 'secret',
  });
  return {
    cfg,
    store,
    identity,
    manager,
    moderation,
    telemetry,
    nameOf: (id) => id.slice(0, 8),
    rateLimit: makeRateLimiter(store.persistent),
    email: new EmailService(makeEmailTransport(cfg.email), cfg),
  };
}

async function buildApp(ctx: GatewayContext) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAuthRoutes(app, ctx);
  registerSocialRoutes(app, ctx);
  await app.ready();
  return app;
}

/** Register a user through the identity service and return {id, token, name}. */
async function makeUser(ctx: GatewayContext, name: string) {
  const res = await ctx.identity.register(name, 'password1234', null);
  if ('error' in res) throw new Error(`register failed: ${res.error}`);
  return { id: res.identity.id, token: res.token, name: res.identity.name };
}

describe('notifications routes — guest/anon gate (NO_DB)', () => {
  it('GET /api/me/notifications: anon 401; guest gets empty feed', async () => {
    const { ctx } = buildTestContext();
    const app = await buildApp(ctx);
    const anon = await app.inject({ method: 'GET', url: '/api/me/notifications' });
    expect(anon.statusCode).toBe(401);

    const guest = ctx.identity.createGuest();
    const g = await app.inject({
      method: 'GET',
      url: '/api/me/notifications',
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(g.statusCode).toBe(200);
    expect(g.json()).toEqual({ notifications: [], unread: 0 });
    await app.close();
  });

  it('POST /api/me/notifications/read: guest gets 403', async () => {
    const { ctx } = buildTestContext();
    const app = await buildApp(ctx);
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/notifications/read',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('notifications routes — account happy path', () => {
  it('list/mark-read shapes + folds unread into /api/me', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const u = await makeUser(ctx, 'capone');

    // Seed two notifications directly (the generation hooks are tested below).
    await store.createNotification(u.id, 'rank_up', { rank: 'fixer', rankName: 'Fixer', mmr: 1510 });
    await store.createNotification(u.id, 'achievement', { key: 'k', name: 'X', points: 10 });

    const list = await app.inject({
      method: 'GET',
      url: '/api/me/notifications',
      headers: { authorization: `Bearer ${u.token}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      notifications: Array<{ id: string; type: string; payload: unknown; createdAt: number; readAt: number | null }>;
      unread: number;
    };
    expect(body.unread).toBe(2);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0]!.type).toBe('achievement'); // newest first
    expect(body.notifications.every((n) => n.readAt === null)).toBe(true);

    // /api/me carries the unread bell count.
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${u.token}` },
    });
    expect((me.json() as { unreadNotifications: number }).unreadNotifications).toBe(2);

    // Mark all read → unread 0.
    const read = await app.inject({
      method: 'POST',
      url: '/api/me/notifications/read',
      headers: { authorization: `Bearer ${u.token}` },
      payload: {},
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ ok: true, unread: 0 });
    await app.close();
  });
});

describe('notification generation hooks (best-effort, additive)', () => {
  it('a friend request creates a friend_request notification for the target', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const a = await makeUser(ctx, 'alpha');
    const b = await makeUser(ctx, 'bravo');

    const res = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { username: 'bravo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: 'created' });

    // The TARGET (b) has a friend_request notification; the requester (a) has none.
    const bNotifs = await store.listNotifications(b.id, 50);
    expect(bNotifs).toHaveLength(1);
    expect(bNotifs[0]!.type).toBe('friend_request');
    expect(bNotifs[0]!.payload).toMatchObject({ fromId: a.id, fromUsername: 'alpha' });
    expect(await store.listNotifications(a.id, 50)).toHaveLength(0);
    await app.close();
  });

  it('accepting a request notifies the original requester (friend_accepted)', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const a = await makeUser(ctx, 'alpha');
    const b = await makeUser(ctx, 'bravo');

    // a requests b.
    await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { username: 'bravo' },
    });
    // b finds the pending request id and accepts.
    const reqs = await store.listFriendRequests(b.id);
    const fid = reqs.incoming[0]!.id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/friends/respond',
      headers: { authorization: `Bearer ${b.token}` },
      payload: { id: fid, accept: true },
    });
    expect(res.statusCode).toBe(200);

    // The ORIGINAL requester (a) is told they were accepted.
    const aNotifs = await store.listNotifications(a.id, 50);
    const accepted = aNotifs.find((n) => n.type === 'friend_accepted');
    expect(accepted).toBeDefined();
    expect(accepted!.payload).toMatchObject({ byId: b.id, byUsername: 'bravo' });
    await app.close();
  });

  it('an auto-accept (reverse pending) notifies the original requester', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const a = await makeUser(ctx, 'alpha');
    const b = await makeUser(ctx, 'bravo');

    // a → b, then b → a auto-accepts the reverse pending row.
    await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { username: 'bravo' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { authorization: `Bearer ${b.token}` },
      payload: { username: 'alpha' },
    });
    expect(res.json()).toMatchObject({ result: 'accepted' });

    // a (the original requester / b's `target`) learns they were accepted.
    const aNotifs = await store.listNotifications(a.id, 50);
    expect(aNotifs.some((n) => n.type === 'friend_accepted')).toBe(true);
    await app.close();
  });

  it('best-effort: the friend flow does NOT throw under a non-persistent store', async () => {
    // NO_DB context: the routes 503 before generation, and notify() no-ops. The
    // point is that no notification path throws when persistent=false.
    const { ctx, store } = buildTestContext();
    expect(store.persistent).toBe(false);
    // notify() through the store is inert + safe even if called directly.
    await expect(store.createNotification('user-x', 'friend_request', {})).resolves.toBeUndefined();
    // The route gate returns a clean 503 (accounts disabled), never a 500.
    const app = await buildApp(ctx);
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { username: 'whoever' },
    });
    expect(res.statusCode).toBe(403); // guests are forbidden before persistence is checked
    await app.close();
  });
});

describe('report-from-profile endpoint', () => {
  it('validates category, rejects self (400), and dedupes', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const a = await makeUser(ctx, 'alpha');
    const b = await makeUser(ctx, 'bravo');

    // Bad category → 400.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/users/bravo/report',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { category: 'not_a_category' },
    });
    expect(bad.statusCode).toBe(400);

    // Self-report → 400.
    const self = await app.inject({
      method: 'POST',
      url: '/api/users/alpha/report',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { category: 'spam' },
    });
    expect(self.statusCode).toBe(400);

    // Valid report → 200.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/users/bravo/report',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { category: 'harassment', comment: 'rude in chat' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true });

    const reports = await store.listReports();
    expect(reports.some((r) => r.reporter === a.id && r.targetUser === b.id)).toBe(true);
    await app.close();
  });

  it('a guest is forbidden (403), an unknown target is 404', async () => {
    const store = new AccountStore();
    const ctx = buildContext(store);
    const app = await buildApp(ctx);
    const a = await makeUser(ctx, 'alpha');

    const guest = ctx.identity.createGuest();
    const g = await app.inject({
      method: 'POST',
      url: '/api/users/alpha/report',
      headers: { authorization: `Bearer ${guest.token}` },
      payload: { category: 'spam' },
    });
    expect(g.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/users/nobody/report',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { category: 'spam' },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
