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
  ): Promise<{ identity: Identity; token: string } | { error: string }> {
    if (!this.store.persistent) return { error: 'accounts_disabled' };
    if (await this.store.getUserByUsername(username)) return { error: 'username_taken' };
    const passwordHash = await hashPassword(password);
    const user = await this.store.createUser({ username, email, passwordHash });
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
    if (!user) return { error: 'invalid_credentials' };
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
    const userId = await this.store.getSessionUserId(hash);
    if (!userId) return null;
    const user = await this.store.getUserById(userId);
    if (!user) return null;
    return {
      id: user.id,
      name: user.username,
      isGuest: false,
      isAdmin: (user.flags & ADMIN_FLAG) !== 0,
    };
  }

  /** Whether an identity is currently banned (login & lobby-join check, §10). */
  async isBanned(identity: Identity): Promise<boolean> {
    if (identity.isGuest) return false;
    const s = await this.store.getActiveSanctions(identity.id);
    return s.banned;
  }
}
