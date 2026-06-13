/**
 * Persistence interface (BUILD_SPEC §10). Two implementations satisfy it:
 * `PgStore` (Postgres via `pg`) and `MemoryStore` (NO_DB=1, guests-only dev/CI).
 *
 * The store is NOT touched in the per-message hot path (§2.2): the gateway uses
 * it only at login/lobby-join (ban/mute checks) and at match end (bulk write).
 */

import type { ReportCategory } from '@nocturne/shared';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  flags: number;
}

export type SanctionType = 'warning' | 'mute' | 'temp_ban' | 'perma_ban';

export interface SanctionRow {
  id: string;
  userId: string;
  type: SanctionType;
  reason: string | null;
  reportId: string | null;
  issuedBy: string;
  startsAt: number;
  expiresAt: number | null;
}

export interface ReportRow {
  id: string;
  reporter: string;
  targetUser: string;
  matchId: string | null;
  category: ReportCategory;
  comment: string | null;
  evidence: unknown;
  createdAt: number;
  status: string;
}

export interface MatchRecord {
  id: string;
  setupId: string;
  config: unknown;
  seed: string;
  startedAt: number;
  endedAt: number;
  outcome: string;
  serverBuild: string;
  players: {
    userOrGuestId: string;
    seat: number;
    role: string;
    faction: string;
    outcome: string;
    survived: boolean;
  }[];
  events: { seq: number; phase: string; event: unknown }[];
  chat: { seq: number; channel: string; senderSeat: number | null; body: string }[];
}

/** Active-sanction summary used at login / lobby-join (§10, §11). */
export interface ActiveSanctions {
  banned: boolean;
  banExpiresAt: number | null;
  muted: boolean;
  muteExpiresAt: number | null;
}

export interface Store {
  readonly persistent: boolean;

  // Users / auth (§7.1) — absent in NO_DB (returns null / throws on register).
  createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<UserRow>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  setLastLogin(id: string): Promise<void>;

  // Sessions (§7.1)
  createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>;
  getSessionUserId(tokenHash: string): Promise<string | null>;
  revokeSession(tokenHash: string): Promise<void>;

  // Moderation (§11)
  getActiveSanctions(userId: string): Promise<ActiveSanctions>;
  insertReport(row: Omit<ReportRow, 'id' | 'createdAt' | 'status'>): Promise<{ deduped: boolean }>;
  listReports(status?: string): Promise<ReportRow[]>;
  applySanction(row: Omit<SanctionRow, 'id' | 'startsAt'> & { startsAt?: number }): Promise<void>;
  listSanctions(userId?: string): Promise<SanctionRow[]>;
  setMute(muterId: string, mutedId: string, on: boolean): Promise<void>;
  getMutes(muterId: string): Promise<string[]>;
  logAdminAction(adminId: string, action: string, detail: unknown): Promise<void>;

  // Match persistence (§10) — bulk write at match end.
  writeMatch(record: MatchRecord): Promise<void>;

  // Telemetry rollup (§15)
  upsertDailyRollup(day: string, fields: Record<string, number>): Promise<void>;

  close(): Promise<void>;
}
