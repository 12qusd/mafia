/**
 * Postgres-backed Store (BUILD_SPEC §10) via `pg`. Used when NO_DB is unset and
 * DATABASE_URL is provided. Ban/mute checks are single indexed queries (§10);
 * match writes are one transaction at match end.
 */

import { Pool } from 'pg';
import type { GameSetup } from '@nocturne/shared';
import { newId } from '../ids.js';
import type {
  Store,
  UserRow,
  ReportRow,
  SanctionRow,
  ActiveSanctions,
  MatchRecord,
  MatchReplay,
  MatchPlayerRecord,
  UserStatsRow,
  LeaderboardEntry,
  PointAwardRecord,
  StatsDelta,
  CustomSetupRow,
  SeasonRow,
  RatingRow,
  RolePreference,
  RankedResultInput,
  RatingLeaderboardEntry,
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
        `INSERT INTO matches (id, setup_id, config, seed, started_at, ended_at, outcome, server_build, fingerprint, mode, season_id)
         VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0), $7, $8, $9, $10, $11)`,
        [
          record.id,
          record.setupId,
          JSON.stringify(record.config),
          record.seed,
          record.startedAt,
          record.endedAt,
          record.outcome,
          record.serverBuild,
          record.fingerprint,
          record.mode ?? null,
          record.seasonId ?? null,
        ],
      );
      for (const p of record.players) {
        await client.query(
          `INSERT INTO match_players (match_id, user_or_guest_id, seat, role, faction, outcome, survived, death_day)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [record.id, p.userOrGuestId, p.seat, p.role, p.faction, p.outcome, p.survived, p.deathDay],
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

  async getMatchReplay(matchId: string): Promise<MatchReplay | null> {
    const m = await this.pool.query<{
      id: string;
      setup_id: string;
      config: unknown;
      seed: string;
      started_at: Date;
      ended_at: Date | null;
      outcome: string | null;
      server_build: string;
      fingerprint: string | null;
    }>(
      `SELECT id, setup_id, config, seed, started_at, ended_at, outcome, server_build, fingerprint
       FROM matches WHERE id = $1`,
      [matchId],
    );
    const row = m.rows[0];
    if (!row) return null;
    const players = await this.pool.query<{
      user_or_guest_id: string;
      seat: number;
      role: string;
      faction: string;
      outcome: string;
      survived: boolean;
      death_day: number | null;
    }>(
      `SELECT user_or_guest_id, seat, role, faction, outcome, survived, death_day
       FROM match_players WHERE match_id = $1 ORDER BY seat`,
      [matchId],
    );
    const events = await this.pool.query<{ seq: number; phase: string; event: unknown }>(
      `SELECT seq, phase, event FROM match_events WHERE match_id = $1 ORDER BY seq`,
      [matchId],
    );
    const chat = await this.pool.query<{
      seq: number;
      channel: string;
      sender_seat: number | null;
      body: string;
    }>(
      `SELECT seq, channel, sender_seat, body FROM chat_messages WHERE match_id = $1 ORDER BY seq`,
      [matchId],
    );
    return {
      id: row.id,
      setupId: row.setup_id,
      config: row.config,
      seed: row.seed,
      startedAt: row.started_at.getTime(),
      endedAt: row.ended_at ? row.ended_at.getTime() : null,
      outcome: row.outcome,
      serverBuild: row.server_build,
      fingerprint: row.fingerprint,
      players: players.rows.map(
        (p): MatchPlayerRecord => ({
          userOrGuestId: p.user_or_guest_id,
          seat: p.seat,
          role: p.role,
          faction: p.faction,
          outcome: p.outcome,
          survived: p.survived,
          deathDay: p.death_day,
        }),
      ),
      events: events.rows.map((e) => ({ seq: e.seq, phase: e.phase, event: e.event })),
      chat: chat.rows.map((c) => ({
        seq: c.seq,
        channel: c.channel,
        senderSeat: c.sender_seat,
        body: c.body,
      })),
    };
  }

  async getMatchParticipants(matchId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_or_guest_id: string }>(
      `SELECT user_or_guest_id FROM match_players WHERE match_id = $1`,
      [matchId],
    );
    return rows.map((r) => r.user_or_guest_id);
  }

  async addToUserStats(userId: string, delta: StatsDelta, at: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_stats
         (user_id, total_points, games_played, games_won, games_survived, days_dead_watched, last_match_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7/1000.0))
       ON CONFLICT (user_id) DO UPDATE SET
         total_points      = user_stats.total_points + EXCLUDED.total_points,
         games_played      = user_stats.games_played + EXCLUDED.games_played,
         games_won         = user_stats.games_won + EXCLUDED.games_won,
         games_survived    = user_stats.games_survived + EXCLUDED.games_survived,
         days_dead_watched = user_stats.days_dead_watched + EXCLUDED.days_dead_watched,
         last_match_at     = EXCLUDED.last_match_at`,
      [
        userId,
        delta.points,
        delta.gamesPlayed,
        delta.gamesWon,
        delta.gamesSurvived,
        delta.daysDeadWatched,
        at,
      ],
    );
  }

  async recordPoints(userId: string, awards: PointAwardRecord[]): Promise<void> {
    for (const a of awards) {
      await this.pool.query(
        `INSERT INTO point_log (id, user_id, match_id, reason, detail, points)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), userId, a.matchId, a.reason, a.detail, a.points],
      );
    }
  }

  async unlockAchievements(
    userId: string,
    items: { key: string; points: number }[],
  ): Promise<string[]> {
    const newly: string[] = [];
    for (const it of items) {
      const res = await this.pool.query(
        `INSERT INTO achievements (user_id, achievement, points_awarded)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, achievement) DO NOTHING`,
        [userId, it.key, it.points],
      );
      if (res.rowCount && res.rowCount > 0) newly.push(it.key);
    }
    return newly;
  }

  async getUserStats(userId: string): Promise<UserStatsRow | null> {
    const { rows } = await this.pool.query<{
      total_points: string;
      games_played: number;
      games_won: number;
      games_survived: number;
      days_dead_watched: number;
      last_match_at: Date | null;
    }>(
      `SELECT total_points, games_played, games_won, games_survived, days_dead_watched, last_match_at
       FROM user_stats WHERE user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      userId,
      totalPoints: Number(r.total_points),
      gamesPlayed: r.games_played,
      gamesWon: r.games_won,
      gamesSurvived: r.games_survived,
      daysDeadWatched: r.days_dead_watched,
      lastMatchAt: r.last_match_at ? r.last_match_at.getTime() : null,
    };
  }

  async getUserAchievements(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ achievement: string }>(
      `SELECT achievement FROM achievements WHERE user_id = $1 ORDER BY unlocked_at`,
      [userId],
    );
    return rows.map((r) => r.achievement);
  }

  async getLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<{
      user_id: string;
      username: string;
      total_points: string;
      games_played: number;
      games_won: number;
    }>(
      `SELECT s.user_id, u.username, s.total_points, s.games_played, s.games_won
       FROM user_stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.total_points DESC LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      totalPoints: Number(r.total_points),
      gamesPlayed: r.games_played,
      gamesWon: r.games_won,
    }));
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

  // --- Custom setups (custom setup builder) --------------------------------

  private mapCustomSetup(r: {
    id: string;
    owner_user_id: string;
    name: string;
    json: unknown;
    created_at: Date;
  }): CustomSetupRow {
    return {
      id: r.id,
      ownerUserId: r.owner_user_id,
      name: r.name,
      setup: r.json as GameSetup,
      createdAt: r.created_at.getTime(),
    };
  }

  async createCustomSetup(
    ownerUserId: string,
    name: string,
    setup: GameSetup,
  ): Promise<CustomSetupRow> {
    const id = `custom:${newId()}`;
    const { rows } = await this.pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      json: unknown;
      created_at: Date;
    }>(
      `INSERT INTO custom_setups (id, owner_user_id, name, json)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_user_id, name, json, created_at`,
      [id, ownerUserId, name, JSON.stringify(setup)],
    );
    return this.mapCustomSetup(rows[0] as never);
  }

  async getCustomSetup(id: string): Promise<CustomSetupRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      json: unknown;
      created_at: Date;
    }>(
      `SELECT id, owner_user_id, name, json, created_at FROM custom_setups WHERE id = $1`,
      [id],
    );
    return rows[0] ? this.mapCustomSetup(rows[0]) : null;
  }

  async listCustomSetups(ownerUserId: string): Promise<CustomSetupRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      json: unknown;
      created_at: Date;
    }>(
      `SELECT id, owner_user_id, name, json, created_at
       FROM custom_setups WHERE owner_user_id = $1 ORDER BY created_at DESC`,
      [ownerUserId],
    );
    return rows.map((r) => this.mapCustomSetup(r));
  }

  async deleteCustomSetup(id: string, ownerUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM custom_setups WHERE id = $1 AND owner_user_id = $2`,
      [id, ownerUserId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // --- Ranked play + role preferences (goal: ranked + preferences) ---------

  private mapSeason(r: {
    id: string;
    name: string;
    started_at: Date;
    ended_at: Date | null;
    is_current: boolean;
  }): SeasonRow {
    return {
      id: r.id,
      name: r.name,
      startedAt: r.started_at.getTime(),
      endedAt: r.ended_at ? r.ended_at.getTime() : null,
      isCurrent: r.is_current,
    };
  }

  async getCurrentSeason(): Promise<SeasonRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      started_at: Date;
      ended_at: Date | null;
      is_current: boolean;
    }>(
      `SELECT id, name, started_at, ended_at, is_current FROM seasons WHERE is_current LIMIT 1`,
    );
    return rows[0] ? this.mapSeason(rows[0]) : null;
  }

  async ensureCurrentSeason(name: string): Promise<SeasonRow> {
    // Insert a current season only if none exists; the partial unique index on
    // is_current guarantees at most one even under a race (then we re-read it).
    await this.pool.query(
      `INSERT INTO seasons (name, is_current)
       SELECT $1, true
       WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE is_current)
       ON CONFLICT DO NOTHING`,
      [name],
    );
    const cur = await this.getCurrentSeason();
    if (cur) return cur;
    // Lost the race and the winner's row is current — read it back.
    const again = await this.getCurrentSeason();
    if (again) return again;
    throw new Error('failed to ensure a current season');
  }

  private mapRating(r: {
    user_id: string;
    mode: string;
    season_id: string;
    mmr: number;
    rd: number;
    vol: number;
    games: number;
    wins: number;
    updated_at: Date;
  }): RatingRow {
    return {
      userId: r.user_id,
      mode: r.mode,
      seasonId: r.season_id,
      mmr: r.mmr,
      rd: r.rd,
      vol: r.vol,
      games: r.games,
      wins: r.wins,
      updatedAt: r.updated_at.getTime(),
    };
  }

  async getRating(userId: string, mode: string, seasonId: string): Promise<RatingRow | null> {
    const { rows } = await this.pool.query<{
      user_id: string;
      mode: string;
      season_id: string;
      mmr: number;
      rd: number;
      vol: number;
      games: number;
      wins: number;
      updated_at: Date;
    }>(
      `SELECT user_id, mode, season_id, mmr, rd, vol, games, wins, updated_at
       FROM ratings WHERE user_id = $1 AND mode = $2 AND season_id = $3`,
      [userId, mode, seasonId],
    );
    return rows[0] ? this.mapRating(rows[0]) : null;
  }

  async upsertRating(row: RatingRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO ratings (user_id, mode, season_id, mmr, rd, vol, games, wins, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id, mode, season_id) DO UPDATE SET
         mmr = EXCLUDED.mmr,
         rd = EXCLUDED.rd,
         vol = EXCLUDED.vol,
         games = EXCLUDED.games,
         wins = EXCLUDED.wins,
         updated_at = now()`,
      [row.userId, row.mode, row.seasonId, row.mmr, row.rd, row.vol, row.games, row.wins],
    );
  }

  async getRatingLeaderboard(
    mode: string,
    seasonId: string,
    limit: number,
  ): Promise<RatingLeaderboardEntry[]> {
    const { rows } = await this.pool.query<{
      user_id: string;
      username: string;
      mmr: number;
      rd: number;
      games: number;
      wins: number;
    }>(
      `SELECT r.user_id, u.username, r.mmr, r.rd, r.games, r.wins
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.mode = $1 AND r.season_id = $2
       ORDER BY r.mmr DESC LIMIT $3`,
      [mode, seasonId, Math.max(1, Math.min(limit, 500))],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      mmr: r.mmr,
      rd: r.rd,
      games: r.games,
      wins: r.wins,
    }));
  }

  async getRolePreferences(userId: string): Promise<RolePreference[]> {
    const { rows } = await this.pool.query<{ role: string; preference: string }>(
      `SELECT role, preference FROM role_preferences WHERE user_id = $1 ORDER BY role`,
      [userId],
    );
    return rows.map((r) => ({
      role: r.role,
      preference: r.preference as RolePreference['preference'],
    }));
  }

  async setRolePreference(
    userId: string,
    role: string,
    preference: 'blacklist' | 'prefer' | null,
  ): Promise<void> {
    if (preference === null) {
      await this.pool.query(`DELETE FROM role_preferences WHERE user_id = $1 AND role = $2`, [
        userId,
        role,
      ]);
      return;
    }
    await this.pool.query(
      `INSERT INTO role_preferences (user_id, role, preference)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role) DO UPDATE SET preference = EXCLUDED.preference`,
      [userId, role, preference],
    );
  }

  async writeRankedResults(rows: RankedResultInput[]): Promise<void> {
    for (const r of rows) {
      await this.pool.query(
        `INSERT INTO ranked_results
           (match_id, user_id, mode, mmr_before, mmr_after, rd_before, rd_after, delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (match_id, user_id) DO NOTHING`,
        [r.matchId, r.userId, r.mode, r.mmrBefore, r.mmrAfter, r.rdBefore, r.rdAfter, r.delta],
      );
    }
  }

  async getRankedResults(userId: string, limit: number): Promise<RankedResultInput[]> {
    const { rows } = await this.pool.query<{
      match_id: string;
      user_id: string;
      mode: string;
      mmr_before: number;
      mmr_after: number;
      rd_before: number;
      rd_after: number;
      delta: number;
    }>(
      `SELECT match_id, user_id, mode, mmr_before, mmr_after, rd_before, rd_after, delta
       FROM ranked_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.max(1, Math.min(limit, 500))],
    );
    return rows.map((r) => ({
      matchId: r.match_id,
      userId: r.user_id,
      mode: r.mode,
      mmrBefore: r.mmr_before,
      mmrAfter: r.mmr_after,
      rdBefore: r.rd_before,
      rdAfter: r.rd_after,
      delta: r.delta,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Re-export type to keep the report category narrow in pg-store.
type ReportCategory = ReportRow['category'];
export type { ReportCategory };
