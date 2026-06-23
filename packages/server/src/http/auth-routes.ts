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
import { buildRankedSummary } from '../ranked/award.js';

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
    path: '/',
    maxAge: Math.floor(ctx.cfg.sessionTtlMs / 1000),
  };

  app.post('/api/register', async (req, reply) => {
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const res = await ctx.identity.register(
      parsed.data.username,
      parsed.data.password,
      parsed.data.email ?? null,
    );
    if ('error' in res) return reply.code(409).send({ error: res.error });
    reply.setCookie(COOKIE, res.token, cookieOpts);
    return reply.send({ userId: res.identity.id, name: res.identity.name, token: res.token });
  });

  app.post('/api/login', async (req, reply) => {
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
    if (!identity.isGuest && ctx.store.persistent) {
      const now = Date.now();
      const last = lastPresenceWrite.get(identity.id) ?? 0;
      if (now - last >= PRESENCE_THROTTLE_MS) {
        lastPresenceWrite.set(identity.id, now);
        await ctx.store.touchPresence(identity.id, now);
      }
    }
    return reply.send({
      id: identity.id,
      name: identity.name,
      isGuest: identity.isGuest,
      isAdmin: identity.isAdmin,
      stats,
    });
  });

  // Issue a guest session over HTTP (for clients that prefer a cookie first).
  app.post('/api/guest', async (_req, reply) => {
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
