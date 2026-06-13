/**
 * Postgres-backed Store (BUILD_SPEC §10) via `pg`. Used when NO_DB is unset and
 * DATABASE_URL is provided. Ban/mute checks are single indexed queries (§10);
 * match writes are one transaction at match end.
 */

import { Pool } from 'pg';
import { newId } from '../ids.js';
import type {
  Store,
  UserRow,
  ReportRow,
  SanctionRow,
  ActiveSanctions,
  MatchRecord,
} from './types.js';

interface PgUser {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  flags: number;
}

export class PgStore implements Store {
  readonly persistent = true;
  constructor(private readonly pool: Pool) {}

  static fromUrl(databaseUrl: string): PgStore {
    return new PgStore(new Pool({ connectionString: databaseUrl, max: 10 }));
  }

  private mapUser(r: PgUser): UserRow {
    return {
      id: r.id,
      username: r.username,
      email: r.email,
      passwordHash: r.password_hash,
      flags: r.flags,
    };
  }

  async createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<UserRow> {
    const { rows } = await this.pool.query<PgUser>(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id, username, email, password_hash, flags`,
      [input.username, input.email, input.passwordHash],
    );
    return this.mapUser(rows[0] as PgUser);
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<PgUser>(
      `SELECT id, username, email, password_hash, flags FROM users WHERE username = $1`,
      [username],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<PgUser>(
      `SELECT id, username, email, password_hash, flags FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async setLastLogin(id: string): Promise<void> {
    await this.pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
  }

  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [tokenHash, userId, expiresAt],
    );
  }

  async getSessionUserId(tokenHash: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM sessions
       WHERE token_hash = $1 AND NOT revoked AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0]?.user_id ?? null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked = true WHERE token_hash = $1`, [tokenHash]);
  }

  async getActiveSanctions(userId: string): Promise<ActiveSanctions> {
    const { rows } = await this.pool.query<{ type: string; expires_at: Date | null }>(
      `SELECT type, expires_at FROM sanctions
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [userId],
    );
    let banned = false;
    let muted = false;
    let banExpiresAt: number | null = null;
    let muteExpiresAt: number | null = null;
    for (const r of rows) {
      const exp = r.expires_at ? r.expires_at.getTime() : null;
      if (r.type === 'perma_ban') banned = true;
      if (r.type === 'temp_ban') {
        banned = true;
        banExpiresAt = exp;
      }
      if (r.type === 'mute') {
        muted = true;
        muteExpiresAt = exp;
      }
    }
    return { banned, banExpiresAt, muted, muteExpiresAt };
  }

  async insertReport(
    row: Omit<ReportRow, 'id' | 'createdAt' | 'status'>,
  ): Promise<{ deduped: boolean }> {
    const res = await this.pool.query(
      `INSERT INTO reports (id, reporter, target_user, match_id, category, comment, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (target_user, match_id, reporter) DO NOTHING`,
      [
        newId(),
        row.reporter,
        row.targetUser,
        row.matchId,
        row.category,
        row.comment,
        JSON.stringify(row.evidence ?? null),
      ],
    );
    return { deduped: res.rowCount === 0 };
  }

  async listReports(status?: string): Promise<ReportRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      reporter: string;
      target_user: string;
      match_id: string | null;
      category: string;
      comment: string | null;
      evidence: unknown;
      created_at: Date;
      status: string;
    }>(
      status
        ? `SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 500`
        : `SELECT * FROM reports ORDER BY created_at DESC LIMIT 500`,
      status ? [status] : [],
    );
    return rows.map((r) => ({
      id: r.id,
      reporter: r.reporter,
      targetUser: r.target_user,
      matchId: r.match_id,
      category: r.category as ReportRow['category'],
      comment: r.comment,
      evidence: r.evidence,
      createdAt: r.created_at.getTime(),
      status: r.status,
    }));
  }

  async applySanction(
    row: Omit<SanctionRow, 'id' | 'startsAt'> & { startsAt?: number },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sanctions (id, user_id, type, reason, report_id, issued_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${row.expiresAt ? 'to_timestamp($7 / 1000.0)' : 'NULL'})`,
      row.expiresAt
        ? [newId(), row.userId, row.type, row.reason, row.reportId, row.issuedBy, row.expiresAt]
        : [newId(), row.userId, row.type, row.reason, row.reportId, row.issuedBy],
    );
  }

  async listSanctions(userId?: string): Promise<SanctionRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      type: string;
      reason: string | null;
      report_id: string | null;
      issued_by: string;
      starts_at: Date;
      expires_at: Date | null;
    }>(
      userId
        ? `SELECT * FROM sanctions WHERE user_id = $1 ORDER BY starts_at DESC LIMIT 500`
        : `SELECT * FROM sanctions ORDER BY starts_at DESC LIMIT 500`,
      userId ? [userId] : [],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type as SanctionRow['type'],
      reason: r.reason,
      reportId: r.report_id,
      issuedBy: r.issued_by,
      startsAt: r.starts_at.getTime(),
      expiresAt: r.expires_at ? r.expires_at.getTime() : null,
    }));
  }

  async setMute(muterId: string, mutedId: string, on: boolean): Promise<void> {
    if (on) {
      await this.pool.query(
        `INSERT INTO mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [muterId, mutedId],
      );
    } else {
      await this.pool.query(`DELETE FROM mutes WHERE muter_id = $1 AND muted_id = $2`, [
        muterId,
        mutedId,
      ]);
    }
  }

  async getMutes(muterId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ muted_id: string }>(
      `SELECT muted_id FROM mutes WHERE muter_id = $1`,
      [muterId],
    );
    return rows.map((r) => r.muted_id);
  }

  async logAdminAction(adminId: string, action: string, detail: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_audit (admin_id, action, detail) VALUES ($1, $2, $3)`,
      [adminId, action, JSON.stringify(detail ?? null)],
    );
  }

  async writeMatch(record: MatchRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO matches (id, setup_id, config, seed, started_at, ended_at, outcome, server_build)
         VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, $8)`,
        [
          record.id,
          record.setupId,
          JSON.stringify(record.config),
          record.seed,
          record.startedAt,
          record.endedAt,
          record.outcome,
          record.serverBuild,
        ],
      );
      for (const p of record.players) {
        await client.query(
          `INSERT INTO match_players (match_id, user_or_guest_id, seat, role, faction, outcome, survived)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [record.id, p.userOrGuestId, p.seat, p.role, p.faction, p.outcome, p.survived],
        );
      }
      for (const e of record.events) {
        await client.query(
          `INSERT INTO match_events (match_id, seq, phase, event) VALUES ($1, $2, $3, $4)`,
          [record.id, e.seq, e.phase, JSON.stringify(e.event)],
        );
      }
      for (const c of record.chat) {
        await client.query(
          `INSERT INTO chat_messages (match_id, seq, channel, sender_seat, body) VALUES ($1, $2, $3, $4, $5)`,
          [record.id, c.seq, c.channel, c.senderSeat, c.body],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async upsertDailyRollup(day: string, fields: Record<string, number>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    const setSql = cols.map((c) => `${c} = telemetry_daily.${c} + EXCLUDED.${c}`).join(', ');
    const insertCols = ['day', ...cols].join(', ');
    const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ');
    await this.pool.query(
      `INSERT INTO telemetry_daily (${insertCols}) VALUES (${placeholders})
       ON CONFLICT (day) DO UPDATE SET ${setSql}`,
      [day, ...cols.map((c) => fields[c])],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Re-export type to keep the report category narrow in pg-store.
type ReportCategory = ReportRow['category'];
export type { ReportCategory };
