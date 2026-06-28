/**
 * Admin HTTP route authz + happy-path shape (BUILD_SPEC §11.3, §15).
 *
 * The admin surface is guarded two ways (see `requireAdmin` in admin-routes.ts):
 *   - an `x-admin-token` header matching `cfg.adminToken` (bootstrap for solo
 *     ops), OR
 *   - an authenticated identity whose `resolveToken` resolves to `isAdmin:true`.
 * A guest / non-admin account / anonymous caller must be rejected with 403.
 *
 * These run under the NO_DB (guests-only) context. The moderation reads/writes
 * exercised here (listReports / applySanction / getActiveSanctions / listSanctions)
 * are fully implemented by the MemoryStore, so the happy paths are real. Audit
 * logging (`store.logAdminAction`) is a no-op in NO_DB, so we assert it via a spy.
 * The season rollover additionally needs a persistent store, faked per-test.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { registerAdminRoutes } from '../http/admin-routes.js';
import type { GatewayContext } from '../ws/context.js';

const ADMIN_TOKEN = 'test-admin-token-very-long-and-random-000';

/** Build a minimal Fastify app with the admin routes mounted over a NO_DB ctx. */
async function buildAdminApp(opts: { adminToken?: string } = {}) {
  const { ctx, store } = buildTestContext();
  // Pin a known admin token so the header-auth branch is exercised deterministically.
  (ctx.cfg as { adminToken?: string }).adminToken = opts.adminToken ?? ADMIN_TOKEN;
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAdminRoutes(app, ctx);
  await app.ready();
  return { app, ctx, store };
}

/** Make the MemoryStore present as persistent for the duration of a test. */
function makePersistent(ctx: GatewayContext): void {
  Object.defineProperty(ctx.store, 'persistent', { value: true, configurable: true });
}

/** Stub token resolution so a Bearer token maps to a fixed admin/non-admin identity. */
function stubIdentity(
  ctx: GatewayContext,
  byToken: Record<string, { id: string; isAdmin: boolean }>,
): void {
  ctx.identity.resolveToken = (async (token: string | undefined) =>
    (token && byToken[token]) || null) as typeof ctx.identity.resolveToken;
}

const ADMIN = { id: 'user-admin000', name: 'Boss', isGuest: false, isAdmin: true } as const;

// --- Authz boundary: every admin endpoint rejects non-admins -----------------

describe('admin routes — authz gate', () => {
  const ENDPOINTS: Array<{ method: 'GET' | 'POST'; url: string; payload?: unknown }> = [
    { method: 'GET', url: '/admin/stats' },
    { method: 'GET', url: '/admin/reports' },
    { method: 'GET', url: '/admin' },
    { method: 'POST', url: '/admin/sanction', payload: { userId: 'u1', type: 'mute' } },
    { method: 'POST', url: '/api/admin/seasons/rollover', payload: {} },
  ];

  it('anonymous (no token) is forbidden on every endpoint', async () => {
    const { app } = await buildAdminApp();
    for (const e of ENDPOINTS) {
      const res = await app.inject({ method: e.method, url: e.url, payload: e.payload });
      expect(res.statusCode, `${e.method} ${e.url}`).toBe(403);
    }
    await app.close();
  });

  it('a guest identity is forbidden on every endpoint', async () => {
    const { app, ctx } = await buildAdminApp();
    const guest = ctx.identity.createGuest();
    for (const e of ENDPOINTS) {
      const res = await app.inject({
        method: e.method,
        url: e.url,
        headers: { authorization: `Bearer ${guest.token}` },
        payload: e.payload,
      });
      expect(res.statusCode, `${e.method} ${e.url}`).toBe(403);
    }
    await app.close();
  });

  it('a non-admin account is forbidden on every endpoint', async () => {
    const { app, ctx } = await buildAdminApp();
    stubIdentity(ctx, { 'tok-member': { id: 'user-member00', isAdmin: false } });
    for (const e of ENDPOINTS) {
      const res = await app.inject({
        method: e.method,
        url: e.url,
        headers: { authorization: 'Bearer tok-member' },
        payload: e.payload,
      });
      expect(res.statusCode, `${e.method} ${e.url}`).toBe(403);
    }
    await app.close();
  });

  it('a wrong x-admin-token is forbidden', async () => {
    const { app } = await buildAdminApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports',
      headers: { 'x-admin-token': 'not-the-token' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// --- Happy paths: admin-token header branch ----------------------------------

describe('admin routes — admin-token happy paths', () => {
  it('GET /admin/stats returns the telemetry snapshot shape', async () => {
    const { app } = await buildAdminApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, number>;
    // Telemetry counters surface as numbers.
    expect(typeof body.matchesStarted).toBe('number');
    expect(typeof body.completionRate).toBe('number');
    expect(body).toHaveProperty('reports');
    await app.close();
  });

  it('GET /admin/reports lists only OPEN reports', async () => {
    const { app, ctx } = await buildAdminApp();
    // Seed two reports against different targets (distinct match ⇒ no dedupe).
    await ctx.moderation.report({
      reporter: 'r1',
      targetUser: 'bad-actor-1',
      matchId: 'm1',
      category: 'cheating',
      comment: 'sus',
      chatContext: [],
    });
    await ctx.moderation.report({
      reporter: 'r2',
      targetUser: 'bad-actor-2',
      matchId: 'm2',
      category: 'harassment',
      comment: null,
      chatContext: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/reports',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const reports = res.json() as Array<{ targetUser: string; status: string }>;
    expect(reports).toHaveLength(2);
    expect(reports.every((r) => r.status === 'open')).toBe(true);
    expect(reports.map((r) => r.targetUser).sort()).toEqual(['bad-actor-1', 'bad-actor-2']);
    await app.close();
  });

  it('GET /admin renders the HTML console with the open-report rows', async () => {
    const { app, ctx } = await buildAdminApp();
    await ctx.moderation.report({
      reporter: 'r1',
      targetUser: 'bad-actor-html',
      matchId: 'm1',
      category: 'cheating',
      comment: 'see chat',
      chatContext: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Nocturne Admin');
    expect(res.body).toContain('bad-actor-html');
    await app.close();
  });

  it('POST /admin/sanction records a sanction reflected in getActiveSanctions + audits it', async () => {
    const { app, store } = await buildAdminApp();
    const auditSpy = vi.spyOn(store, 'logAdminAction');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sanction',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { userId: 'naughty-1', type: 'temp_ban', reason: 'griefing', durationMs: 3600_000 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    // The sanction is live and reflected in the active-sanctions read.
    const active = await store.getActiveSanctions('naughty-1');
    expect(active.banned).toBe(true);
    expect(active.banExpiresAt).toBeGreaterThan(Date.now());

    // And it is surfaced in the per-user sanction list.
    const list = await store.listSanctions('naughty-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('temp_ban');
    expect(list[0]!.issuedBy).toBe('admin-token');

    // The action was audited (issuer = the admin-token bootstrap identity).
    expect(auditSpy).toHaveBeenCalledWith(
      'admin-token',
      'apply_sanction',
      expect.objectContaining({ userId: 'naughty-1', type: 'temp_ban' }),
    );
    await app.close();
  });

  it('POST /admin/sanction validates the body (bad type → 400, missing userId → 400)', async () => {
    const { app } = await buildAdminApp();
    const badType = await app.inject({
      method: 'POST',
      url: '/admin/sanction',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { userId: 'u1', type: 'not-a-real-sanction' },
    });
    expect(badType.statusCode).toBe(400);

    const missingUser = await app.inject({
      method: 'POST',
      url: '/admin/sanction',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { type: 'mute' },
    });
    expect(missingUser.statusCode).toBe(400);
    await app.close();
  });
});

// --- Happy path: authenticated admin identity branch -------------------------

describe('admin routes — isAdmin identity branch', () => {
  it('an isAdmin identity can list reports + sanction (audited under its id)', async () => {
    const { app, ctx, store } = await buildAdminApp();
    stubIdentity(ctx, { 'tok-admin': ADMIN });
    const auditSpy = vi.spyOn(store, 'logAdminAction');

    const reports = await app.inject({
      method: 'GET',
      url: '/admin/reports',
      headers: { authorization: 'Bearer tok-admin' },
    });
    expect(reports.statusCode).toBe(200);

    const sanction = await app.inject({
      method: 'POST',
      url: '/admin/sanction',
      headers: { authorization: 'Bearer tok-admin' },
      payload: { userId: 'target-7', type: 'mute' },
    });
    expect(sanction.statusCode).toBe(200);
    // Audited under the admin's identity id, not the token bootstrap id.
    expect(auditSpy).toHaveBeenCalledWith(
      ADMIN.id,
      'apply_sanction',
      expect.objectContaining({ userId: 'target-7', type: 'mute' }),
    );
    await app.close();
  });
});

// --- Season rollover (admin-only, persistent-only) ---------------------------

describe('POST /api/admin/seasons/rollover', () => {
  it('a guest is forbidden (gate runs before the persistence check)', async () => {
    const { app, ctx } = await buildAdminApp();
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

  it('an admin under a NON-persistent store gets 400 not_persistent', async () => {
    const { app } = await buildAdminApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/seasons/rollover',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { name: 'Season Z' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('not_persistent');
    await app.close();
  });

  it('an admin under a persistent store rolls the season over + audits it', async () => {
    const { app, ctx, store } = await buildAdminApp();
    makePersistent(ctx);
    const auditSpy = vi.spyOn(store, 'logAdminAction');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/seasons/rollover',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { name: 'Roaring Twenties' },
    });
    expect(res.statusCode).toBe(200);
    // The route surfaces the new season's id + name (not the full row).
    const body = res.json() as { ok: boolean; season: { id: string; name: string } };
    expect(body.ok).toBe(true);
    expect(body.season.name).toBe('Roaring Twenties');
    expect(typeof body.season.id).toBe('string');

    // The rollover is reflected in the season list (current = the new one) + audited.
    const seasons = await store.getSeasons(10);
    expect(seasons[0]!.name).toBe('Roaring Twenties');
    expect(seasons[0]!.isCurrent).toBe(true);
    expect(auditSpy).toHaveBeenCalledWith(
      'admin-token',
      'admin_season_rollover',
      expect.objectContaining({ name: 'Roaring Twenties' }),
    );
    await app.close();
  });

  it('defaults the season name when none is supplied', async () => {
    const { app, ctx, store } = await buildAdminApp();
    makePersistent(ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/seasons/rollover',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { season: { name: string } };
    expect(body.season.name).toMatch(/^Season \d+$/);
    const seasons = await store.getSeasons(10);
    expect(seasons[0]!.name).toBe(body.season.name);
    await app.close();
  });
});
