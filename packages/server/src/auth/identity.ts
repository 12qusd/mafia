/**
 * Identity & session management (BUILD_SPEC §7.1, §10).
 *
 * Two identity kinds:
 *   - registered account (username + argon2id password; private + public lobbies)
 *   - guest (random noir name; private lobbies only, §7.1)
 *
 * Session tokens are random 256-bit; only their hash is stored (§7.1). The same
 * token authenticates HTTP (httpOnly cookie) and WS (hello.token). Guest
 * identities live in-process (no DB row); their token maps to a guest record.
 */

import type { Store } from '../db/index.js';
import type { ServerConfig } from '../config.js';
import { hashToken, newSessionToken, newId, newGuestName } from '../ids.js';
import { hashPassword, verifyPassword } from './passwords.js';

export interface Identity {
  /** Stable id: a user uuid for accounts, a `guest:<uuid>` for guests. */
  id: string;
  name: string;
  isGuest: boolean;
  isAdmin: boolean;
}

export interface GuestRecord {
  id: string;
  name: string;
}

const ADMIN_FLAG = 1;

export class IdentityService {
  /** In-process guest store: guest id → record (no persistence, §7.1). */
  private readonly guests = new Map<string, GuestRecord>();
  /** Guest token-hash → guest id (NO_DB sessions live here too). */
  private readonly guestTokens = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly cfg: ServerConfig,
  ) {}

  // --- Registration / login (accounts) -------------------------------------

  async register(
    username: string,
    password: string,
    email: string | null,
    referredBy: string | null = null,
  ): Promise<{ identity: Identity; token: string } | { error: string }> {
    if (!this.store.persistent) return { error: 'accounts_disabled' };
    const taken = (await this.store.getUserByUsername(username)) !== null;
    // Always run the (expensive) password hash, even when the username is taken,
    // so response timing does not reveal whether an account exists (Task C: no
    // username-enumeration oracle). The 409 result is unchanged; only the work is
    // equalized.
    const passwordHash = await hashPassword(password);
    if (taken) return { error: 'username_taken' };
    // referredBy is resolved + validated by the caller (a real, different account).
    const user = await this.store.createUser({ username, email, passwordHash, referredBy });
    const token = await this.issueSession(user.id);
    return {
      identity: { id: user.id, name: user.username, isGuest: false, isAdmin: false },
      token,
    };
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ identity: Identity; token: string } | { error: string }> {
    if (!this.store.persistent) return { error: 'accounts_disabled' };
    const user = await this.store.getUserByUsername(username);
    if (!user) {
      // Burn an equivalent argon2 verify against a dummy hash so login response
      // timing cannot reveal whether a username exists (no enumeration oracle —
      // symmetric with the equalized register path).
      await verifyPassword(await this.dummyHash(), password);
      return { error: 'invalid_credentials' };
    }
    if (!(await verifyPassword(user.passwordHash, password)))
      return { error: 'invalid_credentials' };
    const sanctions = await this.store.getActiveSanctions(user.id);
    if (sanctions.banned) return { error: 'banned' };
    await this.store.setLastLogin(user.id);
    const token = await this.issueSession(user.id);
    return {
      identity: {
        id: user.id,
        name: user.username,
        isGuest: false,
        isAdmin: (user.flags & ADMIN_FLAG) !== 0,
      },
      token,
    };
  }

  async logout(token: string): Promise<void> {
    const hash = hashToken(token, this.cfg.sessionSecret);
    if (this.guestTokens.has(hash)) {
      this.guestTokens.delete(hash);
      return;
    }
    await this.store.revokeSession(hash);
  }

  private async issueSession(userId: string): Promise<string> {
    const token = newSessionToken();
    const hash = hashToken(token, this.cfg.sessionSecret);
    await this.store.createSession(hash, userId, Date.now() + this.cfg.sessionTtlMs);
    return token;
  }

  // --- Guests --------------------------------------------------------------

  createGuest(): { identity: Identity; token: string } {
    const id = `guest:${newId()}`;
    const name = newGuestName();
    this.guests.set(id, { id, name });
    const token = newSessionToken();
    const hash = hashToken(token, this.cfg.sessionSecret);
    this.guestTokens.set(hash, id);
    return { identity: { id, name, isGuest: true, isAdmin: false }, token };
  }

  // --- Token resolution (HTTP cookie / WS hello) ---------------------------

  async resolveToken(token: string | undefined): Promise<Identity | null> {
    if (!token) return null;
    const hash = hashToken(token, this.cfg.sessionSecret);
    const guestId = this.guestTokens.get(hash);
    if (guestId) {
      const g = this.guests.get(guestId);
      if (g) return { id: g.id, name: g.name, isGuest: true, isAdmin: false };
      return null;
    }
    const session = await this.store.getSession(hash);
    if (!session) return null;
    const user = await this.store.getUserById(session.userId);
    if (!user) return null;
    // Sliding refresh (Task C): once a session is past its half-life, push the
    // expiry back out to a full TTL so an active user is never logged out on a
    // hard cutoff. Gated on the half-life so this is at most one cheap UPDATE per
    // ~half-TTL per session — no per-request write storm.
    await this.maybeRefreshSession(hash, session.expiresAt);
    return {
      id: user.id,
      name: user.username,
      isGuest: false,
      isAdmin: (user.flags & ADMIN_FLAG) !== 0,
    };
  }

  /**
   * Cached dummy argon2 hash used to equalize login timing for unknown
   * usernames. Computed once with the LIVE hashing params (via hashPassword) so
   * a verify against it costs the same as a verify against a real account hash.
   */
  private dummyHashCache: Promise<string> | null = null;
  private dummyHash(): Promise<string> {
    if (!this.dummyHashCache) this.dummyHashCache = hashPassword('nocturne::no-such-user');
    return this.dummyHashCache;
  }

  /**
   * Extend a live session's expiry when it is past the halfway point of its TTL.
   * Best-effort: a failed refresh must never reject an otherwise-valid request.
   */
  private async maybeRefreshSession(hash: string, expiresAt: number): Promise<void> {
    const ttl = this.cfg.sessionTtlMs;
    const now = Date.now();
    // Refresh once we're within the back half of the lifetime (issued_at ≈
    // expiresAt - ttl; halfway ⇒ remaining < ttl/2).
    if (expiresAt - now >= ttl / 2) return;
    try {
      await this.store.extendSession(hash, now + ttl);
    } catch {
      // Ignore: the session is still valid until its current expiry.
    }
  }

  /** Whether an identity is currently banned (login & lobby-join check, §10). */
  async isBanned(identity: Identity): Promise<boolean> {
    if (identity.isGuest) return false;
    const s = await this.store.getActiveSanctions(identity.id);
    return s.banned;
  }
}
