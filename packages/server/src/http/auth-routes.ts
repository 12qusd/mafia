/**
 * Auth HTTP routes (BUILD_SPEC §7.1, §10): register, login, logout, me.
 *
 * Session token is set as an httpOnly cookie for HTTP and returned in the body
 * so a WS client can pass it in `hello.token` (§7.1). Validated with zod.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISPLAY_NAME_MAX, REFERRAL_BONUS } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { buildRankedSummary, RANKED_MODE } from '../ranked/award.js';
import { clientIp } from './rate-limit.js';
import { issueEmailVerification } from './account-routes.js';
import { log } from '../log.js';

const COOKIE = 'nocturne_session';

/** A user uuid (referral `ref` values that look like an account id). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /**
   * Referral/invite: a referrer user id (uuid) OR username. Accepted LENIENTLY
   * (`unknown`) so a garbled/overlong `?ref=` value can NEVER fail validation and
   * block registration — the handler normalizes it best-effort (a non-string or
   * unresolvable value is simply ignored). Referral is purely additive.
   */
  ref: z.unknown().optional(),
});

/** Best-effort, never-throwing normalization of a referral `ref` from the body. */
function normalizeRef(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const trimmed = ref.trim();
  // Cap defensively (a real id is 36 chars; usernames are short). Over-long input
  // is truncated, not rejected — resolveReferrer just won't match it.
  return trimmed.length === 0 ? undefined : trimmed.slice(0, 64);
}

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

  /**
   * Resolve a referral `ref` (a referrer user id OR username) to a real
   * account's id, or null. Returns null on any failure — referral resolution is
   * best-effort and must NEVER block registration.
   */
  async function resolveReferrer(ref: string | undefined): Promise<string | null> {
    if (!ref || !ctx.store.persistent) return null;
    try {
      const byId = UUID_RE.test(ref) ? await ctx.store.getUserById(ref) : null;
      const user = byId ?? (await ctx.store.getUserByUsername(ref));
      return user?.id ?? null;
    } catch {
      return null;
    }
  }

  app.post('/api/register', async (req, reply) => {
    if (registerLimit(clientIp(req), reply)) return reply;
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    // Resolve the referrer (id or username) BEFORE creating the account so the
    // new user's referred_by is set atomically with creation. A self-referral is
    // dropped after creation (the new id can't be the referrer); an unknown ref
    // resolves to null. Best-effort — never blocks registration.
    const referrerId = await resolveReferrer(normalizeRef(parsed.data.ref));
    const res = await ctx.identity.register(
      parsed.data.username,
      parsed.data.password,
      parsed.data.email ?? null,
      referrerId,
    );
    if ('error' in res) return reply.code(409).send({ error: res.error });
    // Award the REFERRER a one-time bonus when the referee is a real, DIFFERENT
    // account. Best-effort: a failed award never affects the registration result.
    if (referrerId && referrerId !== res.identity.id) {
      try {
        await ctx.store.recordPoints(referrerId, [
          { matchId: null, reason: 'referral', detail: res.identity.id, points: REFERRAL_BONUS },
        ]);
        await ctx.store.addToUserStats(
          referrerId,
          { points: REFERRAL_BONUS, gamesPlayed: 0, gamesWon: 0, gamesSurvived: 0, daysDeadWatched: 0 },
          Date.now(),
        );
      } catch (err) {
        log.error('failed to award referral bonus', { referrerId, err: String(err) });
      }
    }
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
    // Notifications center (QoL wave): fold the unread bell count into /api/me so
    // the topbar badge is warm on first load. Additive field; 0 for guests/NO_DB.
    let unreadNotifications = 0;
    if (!identity.isGuest && ctx.store.persistent) {
      try {
        unreadNotifications = await ctx.store.getUnreadNotificationCount(identity.id);
      } catch {
        unreadNotifications = 0; // best-effort: never break /api/me
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
      unreadNotifications,
    });
  });

  // --- Referral / invite link (auth) ---------------------------------------

  // The caller's shareable invite link + how many accounts joined via it. The
  // link encodes the caller's user id as `?ref=`; the home/register flow reads
  // it and passes it back to /api/register. Guests/NO_DB get a null link + 0.
  app.get('/api/me/referral', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest || !ctx.store.persistent) {
      return reply.send({ link: null, count: 0, bonusEach: REFERRAL_BONUS });
    }
    const count = await ctx.store.getReferralCount(identity.id).catch(() => 0);
    return reply.send({
      link: `${ctx.cfg.publicBaseUrl}/?ref=${encodeURIComponent(identity.id)}`,
      count,
      bonusEach: REFERRAL_BONUS,
    });
  });

  // --- Notifications center (QoL wave; auth + persistent) ------------------

  // The caller's recent notifications (newest first, cap 50) + the unread count.
  // Empty + 0 for guests / NO_DB (account-only feature).
  app.get<{ Querystring: { limit?: string } }>('/api/me/notifications', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest || !ctx.store.persistent) {
      return reply.send({ notifications: [], unread: 0 });
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 50));
    const [notifications, unread] = await Promise.all([
      ctx.store.listNotifications(identity.id, limit),
      ctx.store.getUnreadNotificationCount(identity.id),
    ]);
    return reply.send({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        payload: n.payload,
        createdAt: n.createdAt,
        readAt: n.readAt,
      })),
      unread,
    });
  });

  // Mark notifications read: the given ids, or ALL when `ids` is omitted.
  app.post<{ Body: { ids?: unknown } }>('/api/me/notifications/read', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.send({ ok: true, unread: 0 });
    // Accept an array of string ids (cap defensively), or omit to mark all read.
    const raw = (req.body ?? {}) as { ids?: unknown };
    let ids: string[] | undefined;
    if (Array.isArray(raw.ids)) {
      ids = raw.ids.filter((x): x is string => typeof x === 'string').slice(0, 200);
    }
    const unread = await ctx.store.markNotificationsRead(identity.id, ids);
    return reply.send({ ok: true, unread });
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
