/**
 * Auth round-trip (BUILD_SPEC §7.1, §10): argon2id hash/verify + session
 * issue/resolve. Uses a small in-memory persistent store stub so the registered-
 * account path runs (MemoryStore is guests-only by design, §10).
 */

import { describe, it, expect } from 'vitest';
import { IdentityService } from '../auth/identity.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { loadConfig } from '../config.js';
import { MemoryStore } from '../db/memory-store.js';
import type { Store, UserRow, ActiveSanctions } from '../db/types.js';
import { newId } from '../ids.js';

describe('passwords (argon2id)', () => {
  it('hashes and verifies, rejects wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});

describe('guest sessions (§7.1, NO_DB)', () => {
  it('createGuest issues a resolvable token', async () => {
    const cfg = loadConfig({ NO_DB: '1' } as NodeJS.ProcessEnv);
    const svc = new IdentityService(new MemoryStore(), cfg);
    const { identity, token } = svc.createGuest();
    expect(identity.isGuest).toBe(true);
    const resolved = await svc.resolveToken(token);
    expect(resolved?.id).toBe(identity.id);
    await svc.logout(token);
    expect(await svc.resolveToken(token)).toBeNull();
  });

  it('MemoryStore rejects registration (guests-only, §10)', async () => {
    const cfg = loadConfig({ NO_DB: '1' } as NodeJS.ProcessEnv);
    const svc = new IdentityService(new MemoryStore(), cfg);
    const res = await svc.register('alice', 'password123', null);
    expect('error' in res).toBe(true);
  });
});

/** Minimal persistent store mock to exercise the account register/login path. */
class MockPersistentStore extends MemoryStore {
  override readonly persistent = true;
  private users = new Map<string, UserRow>();
  private dbSessions = new Map<string, { userId: string; expiresAt: number }>();
  private banned = new Set<string>();

  override async createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<UserRow> {
    const row: UserRow = {
      id: newId(),
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      flags: 0,
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
  override async setLastLogin(): Promise<void> {}
  override async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.dbSessions.set(tokenHash, { userId, expiresAt });
  }
  override async getSessionUserId(tokenHash: string): Promise<string | null> {
    return this.dbSessions.get(tokenHash)?.userId ?? null;
  }
  override async revokeSession(tokenHash: string): Promise<void> {
    this.dbSessions.delete(tokenHash);
  }
  ban(userId: string): void {
    this.banned.add(userId);
  }
  override async getActiveSanctions(userId: string): Promise<ActiveSanctions> {
    return {
      banned: this.banned.has(userId),
      banExpiresAt: null,
      muted: false,
      muteExpiresAt: null,
    };
  }
}

describe('registered accounts round-trip (§7.1, §10)', () => {
  it('register → resolve token → login → banned login rejected', async () => {
    const cfg = loadConfig();
    const store: Store = new MockPersistentStore();
    const svc = new IdentityService(store, cfg);

    const reg = await svc.register('bogart', 'password1234', 'b@example.com');
    expect('identity' in reg).toBe(true);
    if (!('identity' in reg)) return;
    const resolved = await svc.resolveToken(reg.token);
    expect(resolved?.name).toBe('bogart');
    expect(resolved?.isGuest).toBe(false);

    const login = await svc.login('bogart', 'password1234');
    expect('identity' in login).toBe(true);
    const bad = await svc.login('bogart', 'nope');
    expect('error' in bad).toBe(true);

    (store as MockPersistentStore).ban(reg.identity.id);
    const banned = await svc.login('bogart', 'password1234');
    expect('error' in banned && banned.error).toBe('banned');
  });
});
