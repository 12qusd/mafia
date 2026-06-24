/**
 * Lightweight per-route HTTP rate limiting (Task B — server hardening).
 *
 * Reuses the sliding-window idea already used for WS + social posting, but
 * scoped per HTTP route and keyed per-IP or per-user. There is intentionally NO
 * new dependency: this is a tiny bounded in-memory limiter, sufficient for a
 * single-process server behind a Cloudflare tunnel.
 *
 * Bounded memory: each route keeps at most {@link MAX_KEYS} keys; when full it
 * evicts the oldest (FIFO via Map insertion order) before inserting a new one,
 * so a flood of distinct IPs/users can never grow the map without limit.
 *
 * The limiter is bypassed entirely when `enabled` is false — the app passes
 * `ctx.store.persistent` for this, so NO_DB/CI (which hammers these endpoints)
 * is never throttled.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

/** Max distinct keys retained per route before FIFO eviction kicks in. */
const MAX_KEYS = 20_000;

export interface RouteLimit {
  /** Max requests permitted within {@link windowMs}. */
  max: number;
  /** Sliding-window length in ms. */
  windowMs: number;
}

/** A single route's sliding-window counter map (key → recent request timestamps). */
class RouteLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: RouteLimit) {}

  /**
   * Record a request for `key`. Returns `{ ok: true }` if under the limit, or
   * `{ ok: false, retryAfterMs }` with the time until the oldest hit ages out.
   */
  check(key: string, now: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const cutoff = now - this.limit.windowMs;
    let arr = this.hits.get(key);
    if (!arr) {
      // Evict the oldest key when at capacity (Map preserves insertion order).
      if (this.hits.size >= MAX_KEYS) {
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      arr = [];
      this.hits.set(key, arr);
    }
    // Drop timestamps outside the window.
    let i = 0;
    while (i < arr.length && (arr[i] as number) <= cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length >= this.limit.max) {
      const oldest = arr[0] as number;
      const retryAfterMs = Math.max(0, oldest + this.limit.windowMs - now);
      return { ok: false, retryAfterMs };
    }
    arr.push(now);
    return { ok: true };
  }
}

/**
 * Best-effort client IP for rate-limit bucketing (never for authorization).
 *
 * SECURITY: the server sits behind a Cloudflare tunnel with no Fastify
 * `trustProxy`, so `req.ip` is always the local tunnel peer (127.0.0.1) and the
 * LEFTMOST `x-forwarded-for` hop is fully client-controlled — trusting it would
 * let an attacker forge a fresh source per request and bypass every per-IP
 * limit. So we key on Cloudflare's `cf-connecting-ip` (set by Cloudflare's edge
 * to the real client; not forgeable by the client). Failing that we take the
 * RIGHTMOST `x-forwarded-for` hop — the one our trusted proxy appended, which a
 * client can only forge hops to the LEFT of — and finally `req.ip`.
 */
export function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim().length > 0) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const parts = xff.split(',');
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return req.ip ?? 'unknown';
}

/**
 * Create a route-rate-limiter factory. When `enabled` is false every guard is a
 * no-op (NO_DB/test). `now` is injectable for deterministic tests.
 */
export function makeRateLimiter(enabled: boolean, now: () => number = Date.now) {
  /**
   * Build a guard for one route. Call the returned guard at the top of the
   * handler with the bucket key; if it returns true it has ALREADY sent a 429
   * (with a `Retry-After` header) and the handler should return immediately.
   */
  return function route(limit: RouteLimit): (key: string, reply: FastifyReply) => boolean {
    if (!enabled) return () => false;
    const limiter = new RouteLimiter(limit);
    return (key: string, reply: FastifyReply): boolean => {
      const res = limiter.check(key, now());
      if (res.ok) return false;
      const retryAfterSec = Math.ceil(res.retryAfterMs / 1000);
      reply.header('Retry-After', String(retryAfterSec));
      reply.code(429).send({ error: 'rate_limited' });
      return true;
    };
  };
}

export type RouteGuardFactory = ReturnType<typeof makeRateLimiter>;
