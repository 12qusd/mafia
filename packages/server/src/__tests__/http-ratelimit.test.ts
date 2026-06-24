/**
 * HTTP rate-limiter tests (Wave-1 server hardening): the bounded per-route
 * sliding-window limiter and the security-critical client-IP keying.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeRateLimiter, clientIp } from '../http/rate-limit.js';

/** Minimal reply stub capturing the status + headers a guard sets on a 429. */
function fakeReply(): FastifyReply & { _code: number | null; _headers: Record<string, string>; _body: unknown } {
  const r = {
    _code: null as number | null,
    _headers: {} as Record<string, string>,
    _body: undefined as unknown,
    header(k: string, v: string) {
      this._headers[k.toLowerCase()] = v;
      return this;
    },
    code(c: number) {
      this._code = c;
      return this;
    },
    send(b: unknown) {
      this._body = b;
      return this;
    },
  };
  return r as unknown as FastifyReply & typeof r;
}

function req(headers: Record<string, string>, ip = '127.0.0.1'): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest;
}

describe('clientIp keying (anti-spoof)', () => {
  it('prefers the unforgeable cf-connecting-ip over x-forwarded-for', () => {
    const ip = clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }));
    expect(ip).toBe('203.0.113.7');
  });

  it('never trusts the client-controlled FIRST x-forwarded-for hop', () => {
    // Attacker forges the leftmost hop; only the rightmost (proxy-appended) is trusted.
    const ip = clientIp(req({ 'x-forwarded-for': '6.6.6.6, 10.0.0.2' }));
    expect(ip).toBe('10.0.0.2');
    expect(ip).not.toBe('6.6.6.6');
  });

  it('falls back to req.ip when no proxy headers are present', () => {
    expect(clientIp(req({}, '198.51.100.9'))).toBe('198.51.100.9');
  });
});

describe('makeRateLimiter', () => {
  it('allows up to max within the window, then 429s with Retry-After', () => {
    const t = 1_000;
    const route = makeRateLimiter(true, () => t)({ max: 2, windowMs: 1_000 });
    const a = fakeReply();
    expect(route('ip:1', a)).toBe(false); // 1st ok
    expect(route('ip:1', a)).toBe(false); // 2nd ok
    const blocked = fakeReply();
    expect(route('ip:1', blocked)).toBe(true); // 3rd blocked
    expect(blocked._code).toBe(429);
    expect(blocked._body).toEqual({ error: 'rate_limited' });
    expect(Number(blocked._headers['retry-after'])).toBeGreaterThan(0);
  });

  it('isolates buckets per key', () => {
    const t = 0;
    const route = makeRateLimiter(true, () => t)({ max: 1, windowMs: 1_000 });
    expect(route('a', fakeReply())).toBe(false);
    expect(route('a', fakeReply())).toBe(true); // a is now limited
    expect(route('b', fakeReply())).toBe(false); // b has its own budget
  });

  it('lets requests through again once the window slides past', () => {
    let t = 0;
    const route = makeRateLimiter(true, () => t)({ max: 1, windowMs: 1_000 });
    expect(route('k', fakeReply())).toBe(false);
    expect(route('k', fakeReply())).toBe(true);
    t += 1_001;
    expect(route('k', fakeReply())).toBe(false); // window elapsed
  });

  it('is a complete no-op when disabled (NO_DB/test)', () => {
    const route = makeRateLimiter(false)({ max: 1, windowMs: 1_000 });
    const reply = fakeReply();
    for (let i = 0; i < 100; i++) expect(route('same', reply)).toBe(false);
    expect(reply._code).toBeNull(); // never touched the reply
  });
});
