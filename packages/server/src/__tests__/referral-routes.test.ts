/**
 * Referral / invite feature: route-level checks against a minimal Fastify app
 * over a PERSISTENT mock store (MemoryStore is guests-only, so account paths use
 * a small in-memory persistent subclass). Confirms:
 *   - register with a valid `ref` sets referred_by + awards the referrer once,
 *   - an unknown / self ref is ignored (no award, no referred_by),
 *   - GET /api/me/referral returns the link + count + bonusEach shape,
 *   - getReferralCount counts referees.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { REFERRAL_BONUS } from '@nocturne/shared';
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
import { registerAuthRoutes } from '../http/auth-routes.js';
import { newId } from '../ids.js';
import type { GatewayContext } from '../ws/context.js';
import type { UserRow, ActiveSanctions, PointAwardRecord, StatsDelta } from '../db/types.js';

/** Minimal persistent store: real accounts + referral column + points capture. */
class RefStore extends MemoryStore {
  override readonly persistent = true;
  private users = new Map<string, UserRow & { referredBy: string | null }>();
  private dbSessions = new Map<string, { userId: string; expiresAt: number }>();
  /** Captured point-award ledger writes, per user (for the bonus assertion). */
  readonly points = new Map<string, PointAwardRecord[]>();
  /** Captured stat deltas, per user (the bonus also bumps total_points). */
  readonly statDeltas = new Map<string, StatsDelta[]>();

  override async createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
    referredBy?: string | null;
  }): Promise<UserRow> {
    const row = {
      id: newId(),
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      flags: 0,
      referredBy: input.referredBy ?? null,
    };
    this.users.set(input.username.toLowerCase(), row);
    return row;
  }
  override async getUserByUsername(username: string): Promise<UserRow | null> {
    return this.users.get(username.toLowerCase()) ?? null;
  }
  override async getUserById(id: string): Promise<UserRow | null> {
    for (const u of this.users.values()) if (u.id === id) return u;
    return null;
  }
  override async getReferralCount(userId: string): Promise<number> {
    let n = 0;
    for (const u of this.users.values()) if (u.referredBy === userId) n++;
    return n;
  }
  /** The recorded referrer for a username (test introspection). */
  referredByOf(username: string): string | null {
    return this.users.get(username.toLowerCase())?.referredBy ?? null;
  }
  override async setLastLogin(): Promise<void> {}
  override async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.dbSessions.set(tokenHash, { userId, expiresAt });
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
  override async getActiveSanctions(): Promise<ActiveSanctions> {
    return { banned: false, banExpiresAt: null, muted: false, muteExpiresAt: null };
  }
  override async recordPoints(userId: string, awards: PointAwardRecord[]): Promise<void> {
    this.points.set(userId, [...(this.points.get(userId) ?? []), ...awards]);
  }
  override async addToUserStats(userId: string, delta: StatsDelta): Promise<void> {
    this.statDeltas.set(userId, [...(this.statDeltas.get(userId) ?? []), delta]);
  }
}

async function buildRefApp() {
  const cfg = loadConfig();
  const store = new RefStore();
  const identity = new IdentityService(store, cfg);
  const telemetry = new Telemetry(store);
  const manager = new LobbyManager({
    engine: makeFallbackEngine(),
    store,
    telemetry,
    serverBuild: 'test',
    nameOf: (id) => id.slice(0, 8),
    fingerprintSecret: 'test-fingerprint-secret',
  });
  const ctx: GatewayContext = {
    cfg,
    store,
    identity,
    manager,
    moderation: new Moderation(store),
    telemetry,
    nameOf: (id) => id.slice(0, 8),
    rateLimit: makeRateLimiter(false), // disabled so the suite is never throttled
    email: new EmailService(makeEmailTransport(cfg.email), cfg),
  };
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAuthRoutes(app, ctx);
  await app.ready();
  return { app, store };
}

/** Register a user, returning the JSON body. */
async function register(
  app: Awaited<ReturnType<typeof buildRefApp>>['app'],
  body: Record<string, unknown>,
) {
  const res = await app.inject({ method: 'POST', url: '/api/register', payload: body });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('referral: register with ref', () => {
  it('sets referred_by + awards the referrer once when ref is a real id', async () => {
    const { app, store } = await buildRefApp();
    const referrer = await register(app, { username: 'capone', password: 'password1234' });
    const referrerId = referrer.body['userId'] as string;

    const referee = await register(app, {
      username: 'nitti',
      password: 'password1234',
      ref: referrerId,
    });
    expect(referee.status).toBe(200);
    // referred_by is recorded against the new account.
    expect(store.referredByOf('nitti')).toBe(referrerId);
    // The referrer was awarded exactly one referral ledger row of REFERRAL_BONUS.
    const awards = store.points.get(referrerId) ?? [];
    const referralAwards = awards.filter((a) => a.reason === 'referral');
    expect(referralAwards).toHaveLength(1);
    expect(referralAwards[0]!.points).toBe(REFERRAL_BONUS);
    // And the stat delta carried the same points (so the ladder reflects it).
    const deltas = store.statDeltas.get(referrerId) ?? [];
    expect(deltas.some((d) => d.points === REFERRAL_BONUS)).toBe(true);

    await app.close();
  });

  it('resolves ref by USERNAME as well as id', async () => {
    const { app, store } = await buildRefApp();
    const referrer = await register(app, { username: 'moran', password: 'password1234' });
    const referrerId = referrer.body['userId'] as string;
    await register(app, { username: 'mcgurn', password: 'password1234', ref: 'moran' });
    expect(store.referredByOf('mcgurn')).toBe(referrerId);
    expect((store.points.get(referrerId) ?? []).filter((a) => a.reason === 'referral')).toHaveLength(1);
    await app.close();
  });

  it('ignores an UNKNOWN ref (no referred_by, no award)', async () => {
    const { app, store } = await buildRefApp();
    const r = await register(app, {
      username: 'bugs',
      password: 'password1234',
      ref: 'no-such-user',
    });
    expect(r.status).toBe(200);
    expect(store.referredByOf('bugs')).toBeNull();
    // Nobody was awarded a referral bonus.
    for (const awards of store.points.values()) {
      expect(awards.filter((a) => a.reason === 'referral')).toHaveLength(0);
    }
    await app.close();
  });

  it('a garbled/overlong/non-string ref NEVER blocks registration (best-effort)', async () => {
    const { app, store } = await buildRefApp();
    // Overlong (>64), and a non-string — both must be ignored, not 400.
    const overlong = await register(app, {
      username: 'longshot',
      password: 'password1234',
      ref: 'x'.repeat(500),
    });
    expect(overlong.status).toBe(200);
    expect(store.referredByOf('longshot')).toBeNull();

    const nonString = await register(app, {
      username: 'oddball',
      password: 'password1234',
      ref: { not: 'a string' },
    });
    expect(nonString.status).toBe(200);
    expect(store.referredByOf('oddball')).toBeNull();
    await app.close();
  });

  it('only awards the referrer ONCE even across multiple referees', async () => {
    const { app, store } = await buildRefApp();
    const referrer = await register(app, { username: 'torrio', password: 'password1234' });
    const referrerId = referrer.body['userId'] as string;
    await register(app, { username: 'frankie', password: 'password1234', ref: referrerId });
    await register(app, { username: 'jimmy', password: 'password1234', ref: referrerId });
    const referralAwards = (store.points.get(referrerId) ?? []).filter(
      (a) => a.reason === 'referral',
    );
    // One award per referee (two referees ⇒ two one-time awards, distinct detail).
    expect(referralAwards).toHaveLength(2);
    expect(await store.getReferralCount(referrerId)).toBe(2);
    await app.close();
  });
});

describe('GET /api/me/referral', () => {
  it('returns the caller link + count + bonusEach for a registered account', async () => {
    const { app } = await buildRefApp();
    const reg = await register(app, { username: 'genna', password: 'password1234' });
    const token = reg.body['token'] as string;
    const id = reg.body['userId'] as string;
    // Refer two people to that account.
    await register(app, { username: 'pete', password: 'password1234', ref: id });
    await register(app, { username: 'sam', password: 'password1234', ref: id });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/referral',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { link: string; count: number; bonusEach: number };
    expect(body.link).toContain(`?ref=${encodeURIComponent(id)}`);
    expect(body.count).toBe(2);
    expect(body.bonusEach).toBe(REFERRAL_BONUS);
    await app.close();
  });

  it('401 without auth', async () => {
    const { app } = await buildRefApp();
    const res = await app.inject({ method: 'GET', url: '/api/me/referral' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('null link + 0 count for a guest', async () => {
    const { app } = await buildRefApp();
    // A guest token resolves but isGuest ⇒ link null.
    const guestRes = await app.inject({ method: 'POST', url: '/api/guest' });
    const token = (guestRes.json() as { token: string }).token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/referral',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { link: string | null; count: number; bonusEach: number };
    expect(body.link).toBeNull();
    expect(body.count).toBe(0);
    expect(body.bonusEach).toBe(REFERRAL_BONUS);
    await app.close();
  });
});
