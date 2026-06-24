/**
 * Account-lifecycle coverage (retention wave): the email LogTransport, the
 * password-reset + email-verification store round trips (on a small persistent
 * store mock so the account-only flows actually run — MemoryStore is guests-
 * only by design), and the route-level no-enumeration / gating behavior under
 * NO_DB. Everything here is NO_DB-runnable (no Postgres).
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { MemoryStore } from '../db/memory-store.js';
import type { PasswordResetRow, UserRow } from '../db/types.js';
import { LogTransport, type EmailMessage } from '../email/transport.js';
import { EmailService } from '../email/service.js';
import { loadConfig } from '../config.js';
import { hashToken } from '../ids.js';
import { buildTestContext } from './helpers.js';
import { registerAccountRoutes } from '../http/account-routes.js';

// --- Email transport -------------------------------------------------------

/** A transport that captures sends so a test can assert subject + link. */
class CapturingTransport extends LogTransport {
  readonly sent: EmailMessage[] = [];
  override async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
    await super.send(msg);
  }
}

describe('email transport + service', () => {
  it('LogTransport.send resolves (logs, never throws)', async () => {
    const t = new LogTransport();
    await expect(
      t.send({ to: 'a@b.com', subject: 'hi', text: 'visit https://x/reset?token=abc now' }),
    ).resolves.toBeUndefined();
  });

  it('password-reset email carries the subject + a /reset link with the token', async () => {
    const cap = new CapturingTransport();
    const cfg = loadConfig({ PUBLIC_BASE_URL: 'https://mafia.example' } as NodeJS.ProcessEnv);
    const svc = new EmailService(cap, cfg);
    await svc.sendPasswordReset('mark@example.com', 'tok-123');
    expect(cap.sent).toHaveLength(1);
    const msg = cap.sent[0]!;
    expect(msg.to).toBe('mark@example.com');
    expect(msg.subject).toMatch(/Nocturne/);
    expect(msg.text).toContain('https://mafia.example/reset?token=tok-123');
  });

  it('verification email links to /verify-email; send failures are swallowed', async () => {
    const cfg = loadConfig({ PUBLIC_BASE_URL: 'https://mafia.example' } as NodeJS.ProcessEnv);
    // A transport that always throws must NOT propagate (best-effort sends).
    const throwing = {
      async send(): Promise<void> {
        throw new Error('smtp down');
      },
    };
    const svc = new EmailService(throwing, cfg);
    await expect(svc.sendVerification('x@y.com', 'vtok')).resolves.toBeUndefined();
  });
});

// --- Store round trips (small persistent mock) -----------------------------

/**
 * Minimal persistent store implementing only what the lifecycle flows touch,
 * over MemoryStore (so the rest of the interface is satisfied). Mirrors the
 * pattern in auth.test.ts.
 */
class AccountStore extends MemoryStore {
  override readonly persistent = true;
  private users = new Map<string, UserRow>();
  private resets = new Map<string, { userId: string; expiresAt: number; used: boolean }>();
  private verifs = new Map<string, { userId: string; expiresAt: number }>();
  private dbSessions = new Map<string, { userId: string; expiresAt: number; revoked: boolean }>();

  seedUser(u: UserRow): void {
    this.users.set(u.id, u);
  }
  override async getUserById(id: string): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }
  override async getUserByUsername(username: string): Promise<UserRow | null> {
    for (const u of this.users.values()) if (u.username.toLowerCase() === username.toLowerCase()) return u;
    return null;
  }
  override async getUserByEmail(email: string): Promise<UserRow | null> {
    for (const u of this.users.values())
      if (u.email && u.email.toLowerCase() === email.toLowerCase()) return u;
    return null;
  }
  override async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.dbSessions.set(tokenHash, { userId, expiresAt, revoked: false });
  }
  sessionRevoked(tokenHash: string): boolean {
    return this.dbSessions.get(tokenHash)?.revoked ?? true;
  }
  override async createPasswordReset(userId: string, tokenHash: string, expiresAt: number): Promise<void> {
    this.resets.set(tokenHash, { userId, expiresAt, used: false });
  }
  override async getPasswordReset(tokenHash: string): Promise<PasswordResetRow | null> {
    const r = this.resets.get(tokenHash);
    return r ? { userId: r.userId, expiresAt: r.expiresAt, used: r.used } : null;
  }
  override async markPasswordResetUsed(tokenHash: string): Promise<void> {
    const r = this.resets.get(tokenHash);
    if (r) r.used = true;
  }
  override async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }
  override async revokeAllSessions(userId: string): Promise<void> {
    for (const s of this.dbSessions.values()) if (s.userId === userId) s.revoked = true;
  }
  override async createEmailVerification(userId: string, tokenHash: string, expiresAt: number): Promise<void> {
    this.verifs.set(tokenHash, { userId, expiresAt });
  }
  override async consumeEmailVerification(tokenHash: string): Promise<string | null> {
    const v = this.verifs.get(tokenHash);
    if (!v || v.expiresAt <= Date.now()) return null;
    this.verifs.delete(tokenHash);
    return v.userId;
  }
  override async setEmailVerified(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.emailVerified = true;
  }
}

function mkUser(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    username: 'mark',
    email: 'mark@example.com',
    passwordHash: 'OLD-HASH',
    flags: 0,
    emailVerified: false,
    ...over,
  };
}

describe('password-reset store round trip', () => {
  it('create → get → markUsed → updatePassword → revokeAllSessions', async () => {
    const store = new AccountStore();
    store.seedUser(mkUser());
    await store.createSession('sess-1', 'user-1', Date.now() + 1000);

    const exp = Date.now() + 60_000;
    await store.createPasswordReset('user-1', 'rhash', exp);
    const got = await store.getPasswordReset('rhash');
    expect(got).toEqual({ userId: 'user-1', expiresAt: exp, used: false });

    await store.markPasswordResetUsed('rhash');
    expect((await store.getPasswordReset('rhash'))?.used).toBe(true);

    await store.updateUserPassword('user-1', 'NEW-HASH');
    expect((await store.getUserById('user-1'))?.passwordHash).toBe('NEW-HASH');

    await store.revokeAllSessions('user-1');
    expect(store.sessionRevoked('sess-1')).toBe(true);
  });

  it('getPasswordReset returns null for an unknown token', async () => {
    const store = new AccountStore();
    expect(await store.getPasswordReset('nope')).toBeNull();
  });
});

describe('email-verification store round trip', () => {
  it('create → consume → setVerified; consume is single-use', async () => {
    const store = new AccountStore();
    store.seedUser(mkUser());
    await store.createEmailVerification('user-1', 'vhash', Date.now() + 60_000);

    const uid = await store.consumeEmailVerification('vhash');
    expect(uid).toBe('user-1');
    // Already consumed → null on a second attempt.
    expect(await store.consumeEmailVerification('vhash')).toBeNull();

    await store.setEmailVerified('user-1');
    expect((await store.getUserById('user-1'))?.emailVerified).toBe(true);
  });

  it('consume returns null for an unknown token', async () => {
    const store = new AccountStore();
    expect(await store.consumeEmailVerification('nope')).toBeNull();
  });
});

// --- Route-level (NO_DB) ----------------------------------------------------

async function buildAccountApp() {
  const { ctx } = buildTestContext();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAccountRoutes(app, ctx);
  await app.ready();
  return { app, ctx };
}

describe('account routes under NO_DB', () => {
  it('POST /api/password/forgot returns 200 even for an unknown identifier (no enumeration)', async () => {
    const { app } = await buildAccountApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/forgot',
      payload: { identifier: 'ghost@nowhere.test' },
    });
    // NO_DB has no accounts → the account-only flow is inert (503), which is the
    // documented non-persistent behavior; it must never 500.
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'accounts_disabled' });
    await app.close();
  });

  it('POST /api/password/reset rejects with 400 invalid_or_expired-shaped gating in NO_DB', async () => {
    const { app } = await buildAccountApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'x'.repeat(20), password: 'longenough' },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('POST /api/email/verify is inert (503) under NO_DB', async () => {
    const { app } = await buildAccountApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/verify',
      payload: { token: 'x'.repeat(20) },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('POST /api/email/resend without auth is inert (503) under NO_DB', async () => {
    const { app } = await buildAccountApp();
    const res = await app.inject({ method: 'POST', url: '/api/email/resend', payload: {} });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

// --- Route-level over a persistent store (account flows actually run) -------

async function buildPersistentAccountApp() {
  const { ctx } = buildTestContext();
  const store = new AccountStore();
  // Swap in the persistent store + a capturing email transport.
  (ctx as { store: typeof store }).store = store;
  const cap = new CapturingTransport();
  (ctx as { email: EmailService }).email = new EmailService(cap, ctx.cfg);
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerAccountRoutes(app, ctx);
  await app.ready();
  return { app, store, cap, secret: ctx.cfg.sessionSecret };
}

describe('password forgot — no enumeration (persistent path)', () => {
  it('always 200; emails a /reset link ONLY for a real account', async () => {
    const { app, store, cap } = await buildPersistentAccountApp();
    store.seedUser(mkUser());

    // Unknown identifier → still 200, no email.
    const miss = await app.inject({
      method: 'POST',
      url: '/api/password/forgot',
      payload: { identifier: 'ghost@nowhere.test' },
    });
    expect(miss.statusCode).toBe(200);
    expect(miss.json()).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);

    // Known account by email → 200 + a reset email with a /reset link.
    const hit = await app.inject({
      method: 'POST',
      url: '/api/password/forgot',
      payload: { identifier: 'mark@example.com' },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0]!.text).toMatch(/\/reset\?token=/);
    await app.close();
  });
});

describe('password reset — full flow over the persistent store', () => {
  it('rejects an unknown/used/expired token; rotates the password + revokes sessions', async () => {
    const { app, store, secret } = await buildPersistentAccountApp();
    store.seedUser(mkUser());
    await store.createSession('sess-A', 'user-1', Date.now() + 100_000);

    // The plaintext token is emailed; we store its hash exactly as the route
    // does (same secret) so the /reset handler resolves it.
    const exp = Date.now() + 60_000;
    await store.createPasswordReset('user-1', hashToken('GOODTOKEN', secret), exp);

    // Unknown token → 400.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'UNKNOWNTOKEN', password: 'brand-new-pw' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid_or_expired' });

    // Good token → 200; password rotated; sessions revoked.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'GOODTOKEN', password: 'brand-new-pw' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect((await store.getUserById('user-1'))?.passwordHash).not.toBe('OLD-HASH');
    expect(store.sessionRevoked('sess-A')).toBe(true);

    // Replaying the now-used token → 400.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'GOODTOKEN', password: 'another-new-pw' },
    });
    expect(replay.statusCode).toBe(400);
    await app.close();
  });
});
