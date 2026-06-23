/**
 * Social HTTP routes (Social feature): public profiles, friends, direct
 * messages, public chat channels, a global shoutbox, and presence.
 *
 * HTTP-only with its own DB tables — this NEVER touches the game WS protocol,
 * the engine, or the §5 information-leak path. All routes live under `/api`.
 *
 * Auth model (per the feature spec):
 *  - Reads of public surfaces (profiles, rooms, room messages) are open.
 *  - Writes (profile edit, friend ops, posts, DMs) are ACCOUNT-ONLY: guests and
 *    unauthenticated callers get 403.
 *  - A muted or banned user gets 403 on any chat/shoutbox/DM post.
 *  - Posting endpoints carry a small per-user in-memory cooldown (429 slow_down).
 *
 * The server stores raw text (length-capped + trimmed by zod); the client
 * sanitizes on render.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { buildRankedSummary } from '../ranked/award.js';
import { readToken } from './auth-routes.js';

// --- Length caps (zod) -------------------------------------------------------
const TAGLINE_MAX = 80;
const BIO_MAX = 500;
const ACCENT_MAX = 24;
const SHOUTBOX_BODY_MAX = 280;
const CHANNEL_BODY_MAX = 1000;

const ProfileBody = z.object({
  tagline: z.string().max(TAGLINE_MAX).optional(),
  bio: z.string().max(BIO_MAX).optional(),
  accent: z.string().max(ACCENT_MAX).optional(),
});

const FriendRequestBody = z.object({ username: z.string().min(1).max(64) });
const FriendRespondBody = z.object({ id: z.string().min(1).max(128), accept: z.boolean() });

/** A trimmed, non-empty body capped at `max` chars. */
function bodySchema(max: number) {
  return z.object({ body: z.string().trim().min(1).max(max) });
}

/** Online if last-seen is within this window (Social "who's around"). */
const ONLINE_WINDOW_MS = 120_000;
/** Per-user post cooldown for rooms/DMs. */
const POST_COOLDOWN_MS = 1200;
/** Throttle presence DB writes per user. */
const PRESENCE_THROTTLE_MS = 30_000;

/** Parse a bounded message limit from the query (default 50, cap 100). */
function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.max(1, Math.min(Math.floor(n), 100));
}

export function registerSocialRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Per-user cooldown clocks (in-memory; reset on restart).
  const lastPostAt = new Map<string, number>();
  // Per-user presence-write throttle (in-memory).
  const lastPresenceWrite = new Map<string, number>();

  /** Record presence at most once per PRESENCE_THROTTLE_MS for a user. */
  async function recordPresence(userId: string): Promise<void> {
    if (!ctx.store.persistent) return;
    const now = Date.now();
    const last = lastPresenceWrite.get(userId) ?? 0;
    if (now - last < PRESENCE_THROTTLE_MS) return;
    lastPresenceWrite.set(userId, now);
    await ctx.store.touchPresence(userId, now);
  }

  /** Resolve a non-guest, non-sanctioned poster, or send the right error code. */
  async function requirePoster(
    token: string | undefined,
    reply: FastifyReply,
  ): Promise<{ id: string } | null> {
    const identity = await ctx.identity.resolveToken(token);
    if (!identity) {
      reply.code(401).send({ error: 'not_authenticated' });
      return null;
    }
    if (identity.isGuest) {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (!ctx.store.persistent) {
      reply.code(503).send({ error: 'accounts_disabled' });
      return null;
    }
    const sanctions = await ctx.store.getActiveSanctions(identity.id);
    if (sanctions.muted || sanctions.banned) {
      reply.code(403).send({ error: 'silenced' });
      return null;
    }
    return { id: identity.id };
  }

  /**
   * Enforce the post cooldown per (user, scope). Each stream (a room slug, or a
   * DM thread) has its own bucket, so posting in one channel never rate-limits a
   * post in another channel or a DM — it only deters flooding a single stream.
   * Returns true if the caller is too fast for that scope.
   */
  function tooFast(userId: string, scope: string): boolean {
    const key = `${userId}:${scope}`;
    const now = Date.now();
    const last = lastPostAt.get(key) ?? 0;
    if (now - last < POST_COOLDOWN_MS) return true;
    lastPostAt.set(key, now);
    return false;
  }

  // --- Public profile ------------------------------------------------------

  app.get<{ Params: { username: string } }>(
    '/api/users/:username/profile',
    async (req, reply) => {
      if (!ctx.store.persistent) return reply.code(404).send({ error: 'not_found' });
      const user = await ctx.store.getUserByUsername(req.params.username);
      if (!user) return reply.code(404).send({ error: 'not_found' });

      const [profile, stats, achievements, lastSeenMap] = await Promise.all([
        ctx.store.getProfile(user.id),
        buildUserStatsSummary(ctx.store, user.id),
        ctx.store.getUserAchievements(user.id),
        ctx.store.getLastSeen([user.id]),
      ]);

      const seasonId = ctx.manager.seasonId;
      const ranked = seasonId ? await buildRankedSummary(ctx.store, user.id, seasonId) : null;

      // Compute friendship only for an authed non-guest viewing someone else.
      let friendship:
        | 'none'
        | 'pending_out'
        | 'pending_in'
        | 'friends'
        | 'self'
        | null = null;
      const viewer = await ctx.identity.resolveToken(readToken(req));
      if (viewer && !viewer.isGuest) {
        friendship =
          viewer.id === user.id ? 'self' : await ctx.store.friendshipStatus(viewer.id, user.id);
      }

      return reply.send({
        id: user.id,
        username: user.username,
        memberSince: user.createdAt ?? null,
        tagline: profile?.tagline ?? null,
        bio: profile?.bio ?? null,
        accent: profile?.accent ?? null,
        lastSeen: lastSeenMap[user.id] ?? null,
        stats: stats
          ? {
              totalPoints: stats.totalPoints,
              gamesPlayed: stats.gamesPlayed,
              gamesWon: stats.gamesWon,
              gamesSurvived: stats.gamesSurvived,
              tier: stats.tier,
            }
          : null,
        ranked,
        achievements,
        friendship,
      });
    },
  );

  // Edit own profile (account-only).
  app.post('/api/me/profile', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = ProfileBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    await ctx.store.upsertProfile(identity.id, parsed.data);
    return reply.send({ ok: true });
  });

  // --- Social hub for the signed-in account --------------------------------

  app.get('/api/me/social', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) {
      return reply.send({ friends: [], requests: { incoming: [], outgoing: [] }, threads: [] });
    }
    await recordPresence(identity.id);
    const [friends, requests, threads] = await Promise.all([
      ctx.store.listFriends(identity.id),
      ctx.store.listFriendRequests(identity.id),
      ctx.store.listDmThreads(identity.id),
    ]);
    return reply.send({ friends, requests, threads });
  });

  // --- Friends -------------------------------------------------------------

  app.post('/api/friends/request', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = FriendRequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const target = await ctx.store.getUserByUsername(parsed.data.username);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.id === identity.id) return reply.code(400).send({ error: 'self' });
    const result = await ctx.store.requestFriend(identity.id, target.id);
    return reply.send({ result });
  });

  app.post('/api/friends/respond', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = FriendRespondBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const ok = await ctx.store.respondFriend(identity.id, parsed.data.id, parsed.data.accept);
    if (!ok) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { otherUserId: string } }>(
    '/api/friends/:otherUserId',
    async (req, reply) => {
      const identity = await ctx.identity.resolveToken(readToken(req));
      if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
      if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
      if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
      await ctx.store.removeFriend(identity.id, req.params.otherUserId);
      return reply.send({ ok: true });
    },
  );

  // --- Chat rooms (shoutbox + channels) ------------------------------------

  app.get('/api/rooms', async (_req, reply) => {
    const rooms = await ctx.store.listRooms();
    return reply.send({
      rooms: rooms.map((r) => ({
        slug: r.slug,
        name: r.name,
        topic: r.topic,
        kind: r.kind,
        sort: r.sort,
      })),
    });
  });

  app.get<{ Params: { slug: string }; Querystring: { sinceId?: string; limit?: string } }>(
    '/api/rooms/:slug/messages',
    async (req, reply) => {
      const room = await ctx.store.getRoomBySlug(req.params.slug);
      if (!room) return reply.code(404).send({ error: 'not_found' });
      const limit = parseLimit(req.query.limit);
      const opts = req.query.sinceId
        ? { limit, sinceId: req.query.sinceId }
        : { limit };
      const messages = await ctx.store.listRoomMessages(room.id, opts);
      return reply.send({ messages });
    },
  );

  app.post<{ Params: { slug: string } }>('/api/rooms/:slug/messages', async (req, reply) => {
    const room = await ctx.store.getRoomBySlug(req.params.slug);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const poster = await requirePoster(readToken(req), reply);
    if (!poster) return reply; // requirePoster already sent the error.
    const max = room.kind === 'shoutbox' ? SHOUTBOX_BODY_MAX : CHANNEL_BODY_MAX;
    const parsed = bodySchema(max).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (tooFast(poster.id, `room:${room.slug}`))
      return reply.code(429).send({ error: 'slow_down' });
    const message = await ctx.store.postRoomMessage(room.id, poster.id, parsed.data.body);
    void recordPresence(poster.id);
    return reply.send({ message });
  });

  // --- Direct messages -----------------------------------------------------

  app.get<{ Params: { otherUserId: string }; Querystring: { sinceId?: string; limit?: string } }>(
    '/api/dms/:otherUserId',
    async (req, reply) => {
      const identity = await ctx.identity.resolveToken(readToken(req));
      if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
      if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
      if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
      const other = req.params.otherUserId;
      if (other === identity.id) return reply.code(400).send({ error: 'self' });
      const threadId = await ctx.store.ensureDmThread(identity.id, other);
      const limit = parseLimit(req.query.limit);
      const opts = req.query.sinceId ? { limit, sinceId: req.query.sinceId } : { limit };
      const messages = await ctx.store.listDmMessages(threadId, opts);
      await recordPresence(identity.id);
      return reply.send({ threadId, messages });
    },
  );

  app.post<{ Params: { otherUserId: string } }>('/api/dms/:otherUserId', async (req, reply) => {
    const poster = await requirePoster(readToken(req), reply);
    if (!poster) return reply; // requirePoster already sent the error.
    const other = req.params.otherUserId;
    if (other === poster.id) return reply.code(400).send({ error: 'self' });
    const target = await ctx.store.getUserById(other);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    const parsed = bodySchema(CHANNEL_BODY_MAX).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (tooFast(poster.id, `dm:${other}`)) return reply.code(429).send({ error: 'slow_down' });
    const threadId = await ctx.store.ensureDmThread(poster.id, other);
    const message = await ctx.store.postDm(threadId, poster.id, parsed.data.body);
    void recordPresence(poster.id);
    return reply.send({ message });
  });

  // --- Presence ------------------------------------------------------------

  app.post('/api/presence/ping', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.send({ ok: true }); // guests have no presence row
    await recordPresence(identity.id);
    return reply.send({ ok: true, onlineWindowMs: ONLINE_WINDOW_MS });
  });
}
