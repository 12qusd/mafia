/**
 * Auth HTTP routes (BUILD_SPEC §7.1, §10): register, login, logout, me.
 *
 * Session token is set as an httpOnly cookie for HTTP and returned in the body
 * so a WS client can pass it in `hello.token` (§7.1). Validated with zod.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISPLAY_NAME_MAX } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { buildRankedSummary, RANKED_MODE } from '../ranked/award.js';
import { clientIp } from './rate-limit.js';
import { issueEmailVerification } from './account-routes.js';

const COOKIE = 'nocturne_session';

/** Throttle presence DB writes from the /api/me poll to ≥30s per user (Social). */
const PRESENCE_THROTTLE_MS = 30_000;
const lastPresenceWrite = new Map<string, number>();

const RegisterBody = z.object({
  username: z
    .string()
    .min(3)
    .max(DISPLAY_NAME_MAX)
    .regex(/^[A-Za-z0-9_]+$/, 'alphanumeric/underscore only'),
  password: z.string().min(8).max(200),
  email: z.string().email().max(254).optional(),
});

const LoginBody = z.object({
  username: z.string().min(1).max(DISPLAY_NAME_MAX),
  password: z.string().min(1).max(200),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Secure flag in production so the session cookie is never sent over plain
    // HTTP (Task C). Left off in dev so local http://localhost still works.
    secure: ctx.cfg.production,
    path: '/',
    maxAge: Math.floor(ctx.cfg.sessionTtlMs / 1000),
  };

  // Per-IP rate guards for the unauthenticated auth endpoints (Task B). No-ops
  // when the store is non-persistent (NO_DB/test). Built once at registration.
  const rl = ctx.cfg.rateLimit;
  const registerLimit = ctx.rateLimit({ max: rl.register, windowMs: rl.windowMs });
  const loginLimit = ctx.rateLimit({ max: rl.login, windowMs: rl.windowMs });
  const guestLimit = ctx.rateLimit({ max: rl.guest, windowMs: rl.windowMs });

  app.post('/api/register', async (req, reply) => {
    if (registerLimit(clientIp(req), reply)) return reply;
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const res = await ctx.identity.register(
      parsed.data.username,
      parsed.data.password,
      parsed.data.email ?? null,
    );
    if ('error' in res) return reply.code(409).send({ error: res.error });
    // Account lifecycle (retention wave): on register with an email, fire the
    // verification + welcome notes. Both best-effort — they never block or fail
    // registration (issueEmailVerification awaits only the token row write; the
    // mail send is fire-and-forget inside the EmailService).
    const email = parsed.data.email;
    if (email) {
      await issueEmailVerification(ctx, res.identity.id, email).catch(() => {});
      void ctx.email.sendWelcome(email, res.identity.name);
    }
    reply.setCookie(COOKIE, res.token, cookieOpts);
    return reply.send({ userId: res.identity.id, name: res.identity.name, token: res.token });
  });

  app.post('/api/login', async (req, reply) => {
    if (loginLimit(clientIp(req), reply)) return reply;
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const res = await ctx.identity.login(parsed.data.username, parsed.data.password);
    if ('error' in res) return reply.code(401).send({ error: res.error });
    reply.setCookie(COOKIE, res.token, cookieOpts);
    return reply.send({
      userId: res.identity.id,
      name: res.identity.name,
      isAdmin: res.identity.isAdmin,
      token: res.token,
    });
  });

  app.post('/api/logout', async (req, reply) => {
    const token = readToken(req);
    if (token) await ctx.identity.logout(token);
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/me', async (req, reply) => {
    const token = readToken(req);
    const identity = await ctx.identity.resolveToken(token);
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    // Registered users get their progression stats inline (goal 4), plus their
    // current-season ranked standing when they have one (ranked play).
    const stats =
      !identity.isGuest && ctx.store.persistent
        ? await buildUserStatsSummary(ctx.store, identity.id)
        : null;
    if (stats && ctx.manager.seasonId) {
      const ranked = await buildRankedSummary(ctx.store, identity.id, ctx.manager.seasonId);
      if (ranked) stats.ranked = ranked;
    }
    // Presence (Social): record activity for non-guests, throttled to ≥30s/user.
    // Email-verification state (account lifecycle) is read from the same user row
    // so the client can surface a "verify your email" banner; null for guests.
    let emailVerified: boolean | null = null;
    let hasEmail = false;
    if (!identity.isGuest && ctx.store.persistent) {
      const now = Date.now();
      const last = lastPresenceWrite.get(identity.id) ?? 0;
      if (now - last >= PRESENCE_THROTTLE_MS) {
        lastPresenceWrite.set(identity.id, now);
        await ctx.store.touchPresence(identity.id, now);
      }
      const user = await ctx.store.getUserById(identity.id);
      if (user) {
        emailVerified = user.emailVerified ?? false;
        hasEmail = user.email !== null && user.email !== '';
      }
    }
    return reply.send({
      id: identity.id,
      name: identity.name,
      isGuest: identity.isGuest,
      isAdmin: identity.isAdmin,
      stats,
      emailVerified,
      hasEmail,
    });
  });

  // --- Ranked self-rank + match history (auth, persistent) -----------------

  // The caller's 1-based rank position in the current season + their standing,
  // or null when unplaced (no rating this season). Guests/NO_DB → { rank: null }.
  app.get('/api/me/ranked/rank', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    const seasonId = ctx.manager.seasonId;
    if (identity.isGuest || !ctx.store.persistent || !seasonId) {
      return reply.send({ rank: null, seasonId: seasonId ?? null });
    }
    const [position, summary] = await Promise.all([
      ctx.store.getRankPosition(identity.id, RANKED_MODE, seasonId),
      buildRankedSummary(ctx.store, identity.id, seasonId),
    ]);
    if (position === null || !summary) {
      return reply.send({ rank: null, seasonId });
    }
    return reply.send({ rank: { position, ...summary }, seasonId });
  });

  // The caller's recent ranked match history (newest first): per-match MMR
  // before/after + delta. Empty for guests/NO_DB. Reuses the ranked_results
  // ledger (append-only audit trail). `limit` capped at 50.
  app.get<{ Querystring: { limit?: string } }>('/api/me/ranked/history', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest || !ctx.store.persistent) return reply.send({ history: [] });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 50));
    const rows = await ctx.store.getRankedResults(identity.id, limit);
    const history = rows.map((r) => ({
      matchId: r.matchId,
      mmrBefore: Math.round(r.mmrBefore),
      mmrAfter: Math.round(r.mmrAfter),
      delta: Math.round(r.delta),
    }));
    return reply.send({ history });
  });

  // Issue a guest session over HTTP (for clients that prefer a cookie first).
  app.post('/api/guest', async (req, reply) => {
    if (guestLimit(clientIp(req), reply)) return reply;
    const guest = ctx.identity.createGuest();
    reply.setCookie(COOKIE, guest.token, cookieOpts);
    return reply.send({
      guestId: guest.identity.id,
      name: guest.identity.name,
      token: guest.token,
    });
  });
}

function readToken(req: {
  cookies?: Record<string, string | undefined>;
  headers: Record<string, unknown>;
}): string | undefined {
  const cookie = req.cookies?.[COOKIE];
  if (cookie) return cookie;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

export { readToken, COOKIE };
