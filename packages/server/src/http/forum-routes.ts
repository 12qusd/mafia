/**
 * Forum HTTP routes (Forums feature): a phpBB-style message board —
 * categories → boards → threads (topics) → posts.
 *
 * HTTP-only with its own DB tables — this NEVER touches the game WS protocol,
 * the engine, or the §5 information-leak path. All routes live under `/api`.
 *
 * Auth model (mirrors the Social feature):
 *  - Reads of the index, boards, threads, and posts are open (guests + anon).
 *  - Writes (new thread, new post, edit) are ACCOUNT-ONLY: guests/anon get 403.
 *  - A muted or banned user gets 403 'silenced' on any thread/post create.
 *  - Thread/post creates carry a small per-(user, scope) in-memory cooldown.
 *  - Thread moderation (lock/pin) is admin-only.
 *
 * The server stores raw text (length-capped + trimmed by zod); the client
 * sanitizes on render.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { GatewayContext } from '../ws/context.js';
import { readToken } from './auth-routes.js';
import { notifyMentions } from '../notifications/notify.js';

// --- Length caps + pagination (zod) ------------------------------------------
const TITLE_MIN = 3;
const TITLE_MAX = 120;
const BODY_MAX = 8000;
const THREADS_PAGE_SIZE = 30;
const POSTS_PAGE_SIZE = 20;
/** Forum-search result cap (the store also clamps defensively). */
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 30;

const ThreadCreateBody = z.object({
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
});
const PostCreateBody = z.object({ body: z.string().trim().min(1).max(BODY_MAX) });
const PostEditBody = z.object({ body: z.string().trim().min(1).max(BODY_MAX) });
const ModerateBody = z.object({
  locked: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

/** Per-(user, scope) cooldown for thread/post creation. */
const POST_COOLDOWN_MS = 1500;

/** Parse a 1-based page number from the query (default 1, floored at 1). */
function parsePage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

/** Parse a bounded search limit from the query (default 20, cap 30, floor 1). */
function parseSearchLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SEARCH_LIMIT_DEFAULT;
  return Math.max(1, Math.min(Math.floor(n), SEARCH_LIMIT_MAX));
}

/**
 * Thread/post ids are uuids. A malformed id (e.g. a crawler hitting
 * `/api/forum/threads/garbage`) is definitionally "not found" — guarding here
 * means Postgres never sees an invalid-uuid cast and returns a clean 404 rather
 * than a 500.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerForumRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Per-(user, scope) cooldown clocks (in-memory; reset on restart).
  const lastPostAt = new Map<string, number>();

  /**
   * The set of user ids the (possibly anonymous) viewer has blocked, used to
   * filter blocked authors out of forum reads server-side. Empty for guests/anon.
   */
  async function viewerBlocks(req: { headers: unknown; cookies?: unknown }): Promise<string[]> {
    if (!ctx.store.persistent) return [];
    const viewer = await ctx.identity.resolveToken(readToken(req as never));
    if (!viewer || viewer.isGuest) return [];
    return ctx.store.getMutes(viewer.id);
  }

  /** Resolve a non-guest, non-sanctioned poster, or send the right error code. */
  async function requirePoster(
    token: string | undefined,
    reply: FastifyReply,
  ): Promise<{ id: string; name: string } | null> {
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
    return { id: identity.id, name: identity.name };
  }

  /**
   * True if the caller is too fast for that (user, scope) bucket. When throttled
   * AND a `reply` is supplied, sets a `Retry-After` header (seconds until the
   * cooldown elapses) so the 429 is consistent with the rate-limit pattern.
   */
  function tooFast(userId: string, scope: string, reply?: FastifyReply): boolean {
    const key = `${userId}:${scope}`;
    const now = Date.now();
    const last = lastPostAt.get(key) ?? 0;
    if (now - last < POST_COOLDOWN_MS) {
      if (reply) reply.header('Retry-After', String(Math.ceil((POST_COOLDOWN_MS - (now - last)) / 1000)));
      return true;
    }
    lastPostAt.set(key, now);
    return false;
  }

  // --- Index ---------------------------------------------------------------

  app.get('/api/forum', async (_req, reply) => {
    const index = await ctx.store.listForumIndex();
    return reply.send({ index });
  });

  // --- Search (public; min 2 chars) ----------------------------------------

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/forum/search',
    async (req, reply) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      // Min length is enforced both here (clean 400) and in the store (defensive).
      if (q.length < 2) return reply.send({ results: [] });
      const limit = parseSearchLimit(req.query.limit);
      const results = await ctx.store.searchForum(q, limit);
      return reply.send({ results });
    },
  );

  // --- Board: threads list -------------------------------------------------

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    '/api/forum/boards/:slug',
    async (req, reply) => {
      const board = await ctx.store.getBoardBySlug(req.params.slug);
      if (!board) return reply.code(404).send({ error: 'not_found' });
      const page = parsePage(req.query.page);
      const offset = (page - 1) * THREADS_PAGE_SIZE;
      const { threads, total } = await ctx.store.listThreads(board.id, {
        limit: THREADS_PAGE_SIZE,
        offset,
      });
      return reply.send({
        board: { slug: board.slug, name: board.name, description: board.description },
        threads,
        total,
        page,
        pageSize: THREADS_PAGE_SIZE,
      });
    },
  );

  // --- Board: create a thread ----------------------------------------------

  app.post<{ Params: { slug: string } }>(
    '/api/forum/boards/:slug/threads',
    async (req, reply) => {
      const board = await ctx.store.getBoardBySlug(req.params.slug);
      if (!board) return reply.code(404).send({ error: 'not_found' });
      const poster = await requirePoster(readToken(req), reply);
      if (!poster) return reply; // requirePoster already sent the error.
      const parsed = ThreadCreateBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
      // Cooldown is per-board: creating a topic in one board never blocks
      // creating one in another (or replying to a thread elsewhere).
      if (tooFast(poster.id, `board:${board.slug}`, reply))
        return reply.code(429).send({ error: 'slow_down' });
      const { threadId, postId } = await ctx.store.createThread(
        board.id,
        poster.id,
        parsed.data.title,
        parsed.data.body,
      );
      // @mention notifications (QoL; best-effort — never blocks the post).
      await notifyMentions(ctx.store, poster, parsed.data.body, {
        context: 'forum',
        threadId,
        postId,
      });
      return reply.send({ threadId, postId });
    },
  );

  // --- Thread: read (increments views) -------------------------------------

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>(
    '/api/forum/threads/:id',
    async (req, reply) => {
      if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
      const thread = await ctx.store.getThread(req.params.id);
      if (!thread) return reply.code(404).send({ error: 'not_found' });
      await ctx.store.incrementThreadViews(thread.id);
      const page = parsePage(req.query.page);
      const offset = (page - 1) * POSTS_PAGE_SIZE;
      // Filter out posts by anyone the (authed) viewer has blocked, server-side.
      const blocked = await viewerBlocks(req);
      const listOpts: { limit: number; offset: number; blocked?: string[] } = {
        limit: POSTS_PAGE_SIZE,
        offset,
      };
      if (blocked.length) listOpts.blocked = blocked;
      const { posts, total } = await ctx.store.listPosts(thread.id, listOpts);
      // Reflect the just-counted view in the returned thread.
      return reply.send({
        thread: { ...thread, views: thread.views + 1 },
        posts,
        total,
        page,
        pageSize: POSTS_PAGE_SIZE,
      });
    },
  );

  // --- Thread: reply -------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/forum/threads/:id/posts', async (req, reply) => {
    const poster = await requirePoster(readToken(req), reply);
    if (!poster) return reply; // requirePoster already sent the error.
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = PostCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    // Cooldown is per-thread: replying in one thread never blocks another thread
    // or a new-topic post.
    if (tooFast(poster.id, `thread:${req.params.id}`, reply))
      return reply.code(429).send({ error: 'slow_down' });
    const result = await ctx.store.createPost(req.params.id, poster.id, parsed.data.body);
    if (!result) {
      // Thread missing or locked: disambiguate so the client can show the right note.
      const thread = await ctx.store.getThread(req.params.id);
      if (!thread) return reply.code(404).send({ error: 'not_found' });
      return reply.code(403).send({ error: 'locked' });
    }
    // @mention notifications (QoL; best-effort — never blocks the reply).
    await notifyMentions(ctx.store, poster, parsed.data.body, {
      context: 'forum',
      threadId: req.params.id,
      postId: result.postId,
    });
    return reply.send({ postId: result.postId });
  });

  // --- Post: edit (author-or-admin) ----------------------------------------

  app.post<{ Params: { id: string } }>('/api/forum/posts/:id/edit', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = PostEditBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const ok = await ctx.store.editPost(
      req.params.id,
      identity.id,
      identity.isAdmin,
      parsed.data.body,
    );
    if (!ok) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ ok: true });
  });

  // --- Post: delete (author-or-admin; soft-delete tombstone) ---------------

  app.delete<{ Params: { id: string } }>('/api/forum/posts/:id', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const res = await ctx.store.deleteForumPost(req.params.id, identity.id, identity.isAdmin);
    if (res === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (res === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ ok: true });
  });

  // --- Thread: moderate (admin-only) ---------------------------------------

  app.post<{ Params: { id: string } }>('/api/forum/threads/:id/moderate', async (req, reply) => {
    // Admin gate FIRST — a non-admin must not learn whether the id is even valid.
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (!identity.isAdmin) return reply.code(403).send({ error: 'forbidden' });
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = ModerateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const flags: { locked?: boolean; pinned?: boolean } = {};
    if (parsed.data.locked !== undefined) flags.locked = parsed.data.locked;
    if (parsed.data.pinned !== undefined) flags.pinned = parsed.data.pinned;
    const ok = await ctx.store.setThreadFlags(req.params.id, flags);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ ok: true });
  });
}
