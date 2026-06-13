/**
 * In-memory Store for NO_DB=1 mode (BUILD_SPEC §10).
 *
 * Guests only, no persistence. Registration is rejected (guests-only). Used for
 * dev/bots/CI so the server starts without Postgres. Sessions/mutes live only
 * for the process lifetime; match writes are dropped.
 */

import { newId } from '../ids.js';
import { log } from '../log.js';
import type {
  Store,
  UserRow,
  ReportRow,
  SanctionRow,
  ActiveSanctions,
  MatchRecord,
} from './types.js';

export class MemoryStore implements Store {
  readonly persistent = false;
  private readonly sessions = new Map<string, { userId: string; expiresAt: number }>();
  private readonly mutes = new Map<string, Set<string>>();
  private readonly reports: ReportRow[] = [];
  private readonly sanctions: SanctionRow[] = [];

  constructor() {
    log.warn('NO_DB mode: running guests-only with no persistence (§10).');
  }

  async createUser(): Promise<UserRow> {
    throw new Error('registration disabled in NO_DB mode');
  }
  async getUserByUsername(): Promise<UserRow | null> {
    return null;
  }
  async getUserById(): Promise<UserRow | null> {
    return null;
  }
  async setLastLogin(): Promise<void> {}

  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }
  async getSessionUserId(tokenHash: string): Promise<string | null> {
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return s.userId;
  }
  async revokeSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async getActiveSanctions(userId: string): Promise<ActiveSanctions> {
    const now = Date.now();
    let banned = false;
    let muted = false;
    let banExpiresAt: number | null = null;
    let muteExpiresAt: number | null = null;
    for (const s of this.sanctions) {
      if (s.userId !== userId) continue;
      if (s.expiresAt !== null && s.expiresAt < now) continue;
      if (s.type === 'perma_ban') banned = true;
      if (s.type === 'temp_ban') {
        banned = true;
        banExpiresAt = s.expiresAt;
      }
      if (s.type === 'mute') {
        muted = true;
        muteExpiresAt = s.expiresAt;
      }
    }
    return { banned, banExpiresAt, muted, muteExpiresAt };
  }

  async insertReport(
    row: Omit<ReportRow, 'id' | 'createdAt' | 'status'>,
  ): Promise<{ deduped: boolean }> {
    const dup = this.reports.some(
      (r) =>
        r.targetUser === row.targetUser &&
        r.matchId === row.matchId &&
        r.reporter === row.reporter,
    );
    if (dup) return { deduped: true };
    this.reports.push({ ...row, id: newId(), createdAt: Date.now(), status: 'open' });
    return { deduped: false };
  }
  async listReports(status?: string): Promise<ReportRow[]> {
    return this.reports.filter((r) => !status || r.status === status);
  }
  async applySanction(
    row: Omit<SanctionRow, 'id' | 'startsAt'> & { startsAt?: number },
  ): Promise<void> {
    this.sanctions.push({ ...row, id: newId(), startsAt: row.startsAt ?? Date.now() });
  }
  async listSanctions(userId?: string): Promise<SanctionRow[]> {
    return this.sanctions.filter((s) => !userId || s.userId === userId);
  }
  async setMute(muterId: string, mutedId: string, on: boolean): Promise<void> {
    let set = this.mutes.get(muterId);
    if (!set) {
      set = new Set();
      this.mutes.set(muterId, set);
    }
    if (on) set.add(mutedId);
    else set.delete(mutedId);
  }
  async getMutes(muterId: string): Promise<string[]> {
    return [...(this.mutes.get(muterId) ?? [])];
  }
  async logAdminAction(): Promise<void> {}

  async writeMatch(_record: MatchRecord): Promise<void> {
    // Dropped in NO_DB mode.
  }
  async upsertDailyRollup(): Promise<void> {}

  async close(): Promise<void> {}
}
