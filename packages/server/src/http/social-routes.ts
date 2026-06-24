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
import { ReportCategorySchema } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { buildRankedSummary } from '../ranked/award.js';
import { readToken } from './auth-routes.js';
import { notify } from '../notifications/notify.js';

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
/** Report-from-profile body (QoL wave): a valid category + an optional comment. */
const REPORT_COMMENT_MAX = 500;
const ReportBody = z.object({
  category: ReportCategorySchema,
  comment: z.string().trim().max(REPORT_COMMENT_MAX).optional(),
});
const FriendRespondBody = z.object({ id: z.string().min(1).max(128), accept: z.boolean() });
/** Block/unblock a user by username or id (account-only). */
const BlockBody = z
  .object({
    username: z.string().min(1).max(64).optional(),
    userId: z.string().min(1).max(128).optional(),
    on: z.boolean(),
  })
  .refine((b) => b.username !== undefined || b.userId !== undefined, {
    message: 'username or userId required',
  });

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

/** User ids are uuids; a malformed id is "not found" rather than a Postgres 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerSocialRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Per-user cooldown clocks (in-memory; reset on restart).
  const lastPostAt = new Map<string, number>();
  // Per-user presence-write throttle (in-memory).
  const lastPresenceWrite = new Map<string, number>();
  // Per-route rate guards (Task B): keyed per user, no-op in NO_DB/test.
  const friendRequestLimit = ctx.rateLimit({
    max: ctx.cfg.rateLimit.friendRequest,
    windowMs: ctx.cfg.rateLimit.windowMs,
  });
  const profileEditLimit = ctx.rateLimit({
    max: ctx.cfg.rateLimit.profileEdit,
    windowMs: ctx.cfg.rateLimit.windowMs,
  });
  // Report-from-profile (QoL wave): per-user guard, reusing the friend-request
  // cap as a sensible "deliberate action" rate. No-op under a non-persistent
  // store (NO_DB/test), like every other guard here.
  const reportLimit = ctx.rateLimit({
    max: ctx.cfg.rateLimit.friendRequest,
    windowMs: ctx.cfg.rateLimit.windowMs,
  });

  /** Record presence at most once per PRESENCE_THROTTLE_MS for a user. */
  async function recordPresence(userId: string): Promise<void> {
    if (!ctx.store.persistent) return;
    const now = Date.now();
    const last = lastPresenceWrite.get(userId) ?? 0;
    if (now - last < PRESENCE_THROTTLE_MS) return;
    lastPresenceWrite.set(userId, now);
    await ctx.store.touchPresence(userId, now);
  }

  /**
   * The set of user ids the (possibly anonymous) viewer has blocked, used to
   * filter blocked authors out of room/forum/DM reads server-side. Empty for
   * guests/anon (no mutes) or a non-persistent store.
   */
  async function viewerBlocks(req: { headers: unknown; cookies?: unknown }): Promise<string[]> {
    if (!ctx.store.persistent) return [];
    const viewer = await ctx.identity.resolveToken(readToken(req as never));
    if (!viewer || viewer.isGuest) return [];
    return ctx.store.getMutes(viewer.id);
  }

  /**
   * Resolve an account holder (non-guest), or send the right error code. Unlike
   * {@link requirePoster} this does NOT check mutes/bans — used for non-posting
   * account actions (blocks, marking DMs read, deleting one's own content).
   */
  async function requireAccount(
    token: string | undefined,
    reply: FastifyReply,
  ): Promise<{ id: string; isAdmin: boolean } | null> {
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
    return { id: identity.id, isAdmin: identity.isAdmin };
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
      // Whether the viewer has blocked this user (null for guests/anon/self).
      let blocked: boolean | null = null;
      const viewer = await ctx.identity.resolveToken(readToken(req));
      if (viewer && !viewer.isGuest) {
        if (viewer.id === user.id) {
          friendship = 'self';
        } else {
          friendship = await ctx.store.friendshipStatus(viewer.id, user.id);
          blocked = (await ctx.store.getMutes(viewer.id)).includes(user.id);
        }
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
        blocked,
      });
    },
  );

  // Report a user from their profile (QoL wave; account-only, not self). Resolves
  // username→id and files a report via the moderation service (no match context).
  // Category is validated against the report-category enum; the comment is
  // length-capped. Dedupe (per reporter/target/match) is handled by the store, so
  // a repeat report is a 200 no-op. Rate-limited per user.
  app.post<{ Params: { username: string } }>('/api/users/:username/report', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (reportLimit(identity.id, reply)) return reply;
    const parsed = ReportBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const target = await ctx.store.getUserByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.id === identity.id) return reply.code(400).send({ error: 'self' });
    await ctx.moderation.report({
      reporter: identity.id,
      targetUser: target.id,
      matchId: null,
      category: parsed.data.category,
      comment: parsed.data.comment ?? null,
      chatContext: [],
    });
    return reply.send({ ok: true });
  });

  // Edit own profile (account-only).
  app.post('/api/me/profile', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (profileEditLimit(identity.id, reply)) return reply;
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
      return reply.send({
        friends: [],
        requests: { incoming: [], outgoing: [] },
        threads: [],
        unreadTotal: 0,
      });
    }
    await recordPresence(identity.id);
    const [friends, requests, threads, unreadTotal] = await Promise.all([
      ctx.store.listFriends(identity.id),
      ctx.store.listFriendRequests(identity.id),
      ctx.store.listDmThreads(identity.id),
      ctx.store.getTotalUnread(identity.id),
    ]);
    return reply.send({ friends, requests, threads, unreadTotal });
  });

  // --- Friends -------------------------------------------------------------

  app.post('/api/friends/request', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (friendRequestLimit(identity.id, reply)) return reply;
    const parsed = FriendRequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const target = await ctx.store.getUserByUsername(parsed.data.username);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.id === identity.id) return reply.code(400).send({ error: 'self' });
    // If the addressee has blocked the requester, the request is rejected.
    if ((await ctx.store.getMutes(target.id)).includes(identity.id)) {
      return reply.code(403).send({ error: 'blocked' });
    }
    const result = await ctx.store.requestFriend(identity.id, target.id);
    // Notifications center (QoL wave; best-effort, never blocks the request):
    //  - a NEW pending request → notify the TARGET (someone wants in).
    //  - an auto-accept of a reverse-pending row → notify the ORIGINAL requester
    //    (which is `target` here) that the caller accepted them.
    if (result === 'created') {
      await notify(ctx.store, target.id, 'friend_request', {
        fromId: identity.id,
        fromUsername: identity.name,
      });
    } else if (result === 'accepted') {
      await notify(ctx.store, target.id, 'friend_accepted', {
        byId: identity.id,
        byUsername: identity.name,
      });
    }
    return reply.send({ result });
  });

  app.post('/api/friends/respond', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = FriendRespondBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    // Resolve the original requester BEFORE responding (the pending row is gone
    // afterwards) so an accept can notify them. Best-effort: a lookup miss just
    // means no notification — it never blocks the response.
    let requester: { id: string; username: string } | null = null;
    if (parsed.data.accept) {
      const reqs = await ctx.store.listFriendRequests(identity.id);
      const match = reqs.incoming.find((r) => r.id === parsed.data.id);
      if (match) requester = { id: match.userId, username: match.username };
    }
    const ok = await ctx.store.respondFriend(identity.id, parsed.data.id, parsed.data.accept);
    if (!ok) return reply.code(403).send({ error: 'forbidden' });
    // Notifications center (QoL wave; best-effort): on accept, tell the original
    // requester their request was accepted.
    if (parsed.data.accept && requester) {
      await notify(ctx.store, requester.id, 'friend_accepted', {
        byId: identity.id,
        byUsername: identity.name,
      });
    }
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
        // Recently-active poster count (last 10 min) — the "N chatting" signal.
        activeCount: r.activeCount,
      })),
    });
  });

  app.get<{ Params: { slug: string }; Querystring: { sinceId?: string; limit?: string } }>(
    '/api/rooms/:slug/messages',
    async (req, reply) => {
      const room = await ctx.store.getRoomBySlug(req.params.slug);
      if (!room) return reply.code(404).send({ error: 'not_found' });
      const limit = parseLimit(req.query.limit);
      // Filter out messages by anyone the (authed) viewer has blocked, server-side.
      const blocked = await viewerBlocks(req);
      const opts: { limit: number; sinceId?: string; blocked?: string[] } = { limit };
      if (req.query.sinceId) opts.sinceId = req.query.sinceId;
      if (blocked.length) opts.blocked = blocked;
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
      if (!UUID_RE.test(other)) return reply.code(404).send({ error: 'not_found' });
      if (other === identity.id) return reply.code(400).send({ error: 'self' });
      const threadId = await ctx.store.ensureDmThread(identity.id, other);
      const limit = parseLimit(req.query.limit);
      const opts = req.query.sinceId ? { limit, sinceId: req.query.sinceId } : { limit };
      const messages = await ctx.store.listDmMessages(threadId, opts);
      // Opening a thread marks it read up to now (clears the unread badge).
      await ctx.store.markDmRead(identity.id, threadId, Date.now());
      await recordPresence(identity.id);
      return reply.send({ threadId, messages });
    },
  );

  app.post<{ Params: { otherUserId: string } }>('/api/dms/:otherUserId', async (req, reply) => {
    const poster = await requirePoster(readToken(req), reply);
    if (!poster) return reply; // requirePoster already sent the error.
    const other = req.params.otherUserId;
    if (!UUID_RE.test(other)) return reply.code(404).send({ error: 'not_found' });
    if (other === poster.id) return reply.code(400).send({ error: 'self' });
    const target = await ctx.store.getUserById(other);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // If the RECIPIENT has blocked the sender, the DM is rejected.
    if ((await ctx.store.getMutes(other)).includes(poster.id)) {
      return reply.code(403).send({ error: 'blocked' });
    }
    const parsed = bodySchema(CHANNEL_BODY_MAX).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (tooFast(poster.id, `dm:${other}`)) return reply.code(429).send({ error: 'slow_down' });
    const threadId = await ctx.store.ensureDmThread(poster.id, other);
    const message = await ctx.store.postDm(threadId, poster.id, parsed.data.body);
    void recordPresence(poster.id);
    return reply.send({ message });
  });

  // Mark a DM thread read (clears the unread badge for the open conversation).
  app.post<{ Params: { otherUserId: string } }>(
    '/api/dms/:otherUserId/read',
    async (req, reply) => {
      const account = await requireAccount(readToken(req), reply);
      if (!account) return reply;
      const other = req.params.otherUserId;
      if (!UUID_RE.test(other)) return reply.code(404).send({ error: 'not_found' });
      if (other === account.id) return reply.code(400).send({ error: 'self' });
      const threadId = await ctx.store.ensureDmThread(account.id, other);
      await ctx.store.markDmRead(account.id, threadId, Date.now());
      return reply.send({ ok: true });
    },
  );

  // Soft-delete one of the caller's own DMs (or any DM when admin).
  app.delete<{ Params: { id: string } }>('/api/dms/messages/:id', async (req, reply) => {
    const account = await requireAccount(readToken(req), reply);
    if (!account) return reply;
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const res = await ctx.store.deleteDmMessage(req.params.id, account.id, account.isAdmin);
    if (res === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (res === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ ok: true });
  });

  // Soft-delete one of the caller's own room messages (or any when admin).
  app.delete<{ Params: { id: string } }>('/api/rooms/messages/:id', async (req, reply) => {
    const account = await requireAccount(readToken(req), reply);
    if (!account) return reply;
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const res = await ctx.store.deleteRoomMessage(req.params.id, account.id, account.isAdmin);
    if (res === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (res === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ ok: true });
  });

  // --- User search ---------------------------------------------------------

  app.get<{ Querystring: { q?: string } }>('/api/users/search', async (req, reply) => {
    if (!ctx.store.persistent) return reply.send({ users: [] });
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.send({ users: [] });
    // Exclude the caller + anyone the caller has blocked (if authed).
    const viewer = await ctx.identity.resolveToken(readToken(req));
    const self = viewer && !viewer.isGuest ? viewer.id : undefined;
    const blocked = self ? await ctx.store.getMutes(self) : [];
    const users = await ctx.store.searchUsers(q, 20, self, blocked);
    return reply.send({ users });
  });

  // --- Blocking (reuses the mutes table) -----------------------------------

  app.post('/api/blocks', async (req, reply) => {
    const account = await requireAccount(readToken(req), reply);
    if (!account) return reply;
    const parsed = BlockBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    // Resolve the target by id or username.
    let targetId: string | null = null;
    if (parsed.data.userId) {
      if (!UUID_RE.test(parsed.data.userId)) return reply.code(404).send({ error: 'not_found' });
      const u = await ctx.store.getUserById(parsed.data.userId);
      targetId = u ? u.id : null;
    } else if (parsed.data.username) {
      const u = await ctx.store.getUserByUsername(parsed.data.username);
      targetId = u ? u.id : null;
    }
    if (!targetId) return reply.code(404).send({ error: 'not_found' });
    if (targetId === account.id) return reply.code(400).send({ error: 'self' });
    await ctx.store.setMute(account.id, targetId, parsed.data.on);
    return reply.send({ ok: true, blocked: parsed.data.on });
  });

  app.get('/api/me/blocks', async (req, reply) => {
    const account = await requireAccount(readToken(req), reply);
    if (!account) return reply;
    const ids = await ctx.store.getMutes(account.id);
    // Resolve names; drop any id that no longer maps to a user.
    const users = (
      await Promise.all(
        ids.map(async (id) => {
          const u = await ctx.store.getUserById(id);
          return u ? { id: u.id, username: u.username } : null;
        }),
      )
    ).filter((u): u is { id: string; username: string } => u !== null);
    return reply.send({ users });
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
