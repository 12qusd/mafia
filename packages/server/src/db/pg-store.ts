/**
 * Postgres-backed Store (BUILD_SPEC §10) via `pg`. Used when NO_DB is unset and
 * DATABASE_URL is provided. Ban/mute checks are single indexed queries (§10);
 * match writes are one transaction at match end.
 */

import { Pool } from 'pg';
import { softResetRating, type GameSetup, type NotificationType } from '@nocturne/shared';
import { newId } from '../ids.js';
import type {
  Store,
  UserRow,
  PasswordResetRow,
  ReportRow,
  SanctionRow,
  ActiveSanctions,
  MatchRecord,
  MatchReplay,
  RecentMatchSummary,
  PublicMatchSummary,
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
  ProfileRow,
  ChatRoomRow,
  RoomMessageRow,
  DmMessageRow,
  FriendshipStatus,
  ForumBoardRow,
  ForumIndexCategory,
  ForumIndexBoard,
  ForumThreadListRow,
  ForumThreadView,
  ForumPostRow,
  ForumSearchHit,
  UserSearchHit,
  DmThreadSummary,
  NotificationRow,
} from './types.js';

interface PgUser {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  flags: number;
  created_at?: Date;
  email_verified?: boolean;
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
      ...(r.created_at ? { createdAt: r.created_at.getTime() } : {}),
      ...(r.email_verified !== undefined ? { emailVerified: r.email_verified } : {}),
    };
  }

  async createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
    referredBy?: string | null;
  }): Promise<UserRow> {
    const { rows } = await this.pool.query<PgUser>(
      `INSERT INTO users (username, email, password_hash, referred_by)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, password_hash, flags`,
      [input.username, input.email, input.passwordHash, input.referredBy ?? null],
    );
    return this.mapUser(rows[0] as PgUser);
  }

  async getReferralCount(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM users WHERE referred_by = $1`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0) || 0;
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<PgUser>(
      `SELECT id, username, email, password_hash, flags, created_at, email_verified
       FROM users WHERE username = $1`,
      [username],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<PgUser>(
      `SELECT id, username, email, password_hash, flags, created_at, email_verified
       FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  /** Resolve a user by email (citext, case-insensitive). Used by password reset. */
  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<PgUser>(
      `SELECT id, username, email, password_hash, flags, created_at, email_verified
       FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async setLastLogin(id: string): Promise<void> {
    await this.pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
  }

  async searchUsers(
    q: string,
    limit: number,
    excludeId?: string,
    excludeIds?: string[],
  ): Promise<UserSearchHit[]> {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    const cap = Math.max(1, Math.min(limit, 20));
    // username is citext so ILIKE is case-insensitive. We pass `q` as a literal
    // parameter and build the pattern with a parameter too (no injection). Prefix
    // matches rank above substring matches. `like_escape` neutralises % and _ so
    // user-typed wildcards are treated literally.
    const like = `%${PgStore.likeEscape(trimmed)}%`;
    const prefix = `${PgStore.likeEscape(trimmed)}%`;
    // Exclude the caller + the caller's blocked ids (uuid[] param, ::text-safe).
    const exclude = [...(excludeId ? [excludeId] : []), ...(excludeIds ?? [])];
    const { rows } = await this.pool.query<{ id: string; username: string }>(
      `SELECT id, username
       FROM users
       WHERE username ILIKE $1 ESCAPE '\\'
         AND ($3::uuid[] IS NULL OR NOT (id = ANY($3::uuid[])))
       ORDER BY (username ILIKE $2 ESCAPE '\\') DESC, username ASC
       LIMIT $4`,
      [like, prefix, exclude.length ? exclude : null, cap],
    );
    return rows.map((r) => ({ id: r.id, username: r.username }));
  }

  /** Escape LIKE/ILIKE wildcards so a user query is matched literally. */
  private static likeEscape(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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

  async getSession(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: number } | null> {
    const { rows } = await this.pool.query<{ user_id: string; expires_at: Date }>(
      `SELECT user_id, expires_at FROM sessions
       WHERE token_hash = $1 AND NOT revoked AND expires_at > now()`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return { userId: row.user_id, expiresAt: row.expires_at.getTime() };
  }

  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET expires_at = to_timestamp($2 / 1000.0)
       WHERE token_hash = $1 AND NOT revoked AND expires_at > now()`,
      [tokenHash, expiresAt],
    );
  }

  // --- Account lifecycle: password reset + email verification ---------------

  async createPasswordReset(userId: string, tokenHash: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [tokenHash, userId, expiresAt],
    );
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordResetRow | null> {
    const { rows } = await this.pool.query<{ user_id: string; expires_at: Date; used: boolean }>(
      `SELECT user_id, expires_at, used FROM password_resets WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return { userId: row.user_id, expiresAt: row.expires_at.getTime(), used: row.used };
  }

  async markPasswordResetUsed(tokenHash: string): Promise<void> {
    await this.pool.query(`UPDATE password_resets SET used = true WHERE token_hash = $1`, [
      tokenHash,
    ]);
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      userId,
      passwordHash,
    ]);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked = true WHERE user_id = $1`, [userId]);
  }

  async createEmailVerification(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_verifications (token_hash, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [tokenHash, userId, expiresAt],
    );
  }

  async consumeEmailVerification(tokenHash: string): Promise<string | null> {
    // Single-use: delete the row and return its user id only if still valid.
    const { rows } = await this.pool.query<{ user_id: string }>(
      `DELETE FROM email_verifications
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING user_id`,
      [tokenHash],
    );
    return rows[0]?.user_id ?? null;
  }

  async setEmailVerified(userId: string): Promise<void> {
    await this.pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [userId]);
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

  // --- Public retention surfaces (FINISHED-only, no auth) -------------------
  // Leak-safety: both queries filter `ended_at IS NOT NULL`, so an in-progress
  // match (roles still secret) can never appear in the social proof or share
  // card. A finished match has already revealed roles at game-over.

  async getRecentMatches(limit: number): Promise<RecentMatchSummary[]> {
    const cap = Math.max(1, Math.min(Math.floor(limit) || 0, 30));
    // The seat count AND the winning faction are both derived from match_players
    // in the same grouped pass (one extra aggregate, no extra round-trip). The
    // winner is the array of DISTINCT factions among seats whose outcome = 'win';
    // a single-element array is an unambiguous winner, anything else (0 or >1) is
    // null — exactly the MemoryStore.winningFaction semantics.
    const { rows } = await this.pool.query<{
      id: string;
      setup_id: string;
      outcome: string | null;
      ended_at: Date;
      mode: string | null;
      players: string;
      winners: string[] | null;
    }>(
      `SELECT m.id, m.setup_id, m.outcome, m.ended_at, m.mode,
              COUNT(mp.match_id)::text AS players,
              array_agg(DISTINCT mp.faction) FILTER (WHERE mp.outcome = 'win') AS winners
         FROM matches m
         LEFT JOIN match_players mp ON mp.match_id = m.id
        WHERE m.ended_at IS NOT NULL
          AND (m.config ->> 'testMode') IS DISTINCT FROM 'true'
        GROUP BY m.id
        ORDER BY m.ended_at DESC
        LIMIT $1`,
      [cap],
    );
    return rows.map((r) => ({
      id: r.id,
      setupId: r.setup_id,
      outcome: r.outcome,
      endedAt: r.ended_at.getTime(),
      mode: r.mode,
      players: Number(r.players) || 0,
      // A single distinct winning faction is unambiguous; 0 or >1 ⇒ null.
      winner: Array.isArray(r.winners) && r.winners.length === 1 ? r.winners[0]! : null,
    }));
  }

  async getPublicMatchSummary(matchId: string): Promise<PublicMatchSummary | null> {
    const m = await this.pool.query<{
      id: string;
      setup_id: string;
      outcome: string | null;
      started_at: Date;
      ended_at: Date | null;
      mode: string | null;
    }>(
      // FINISHED-only at the SQL level: a NULL ended_at row never matches. Also
      // exclude admin/dev TEST-mode games from the public summary (data cleanliness;
      // test games never count for ranking/points and shouldn't be publicly shared).
      `SELECT id, setup_id, outcome, started_at, ended_at, mode
         FROM matches
        WHERE id = $1 AND ended_at IS NOT NULL
          AND (config ->> 'testMode') IS DISTINCT FROM 'true'`,
      [matchId],
    );
    const row = m.rows[0];
    if (!row || row.ended_at === null) return null;
    // Join match_players to users so account seats carry a username; guests
    // (whose user_or_guest_id is not a users.id) resolve to null.
    const seats = await this.pool.query<{
      seat: number;
      role: string;
      faction: string;
      outcome: string;
      survived: boolean;
      death_day: number | null;
      name: string | null;
    }>(
      // user_or_guest_id is TEXT (holds account uuids AND guest ids); cast the
      // uuid users.id to text to compare (else Postgres: "operator does not
      // exist: uuid = text"). Guest ids never match a users row → name null.
      `SELECT mp.seat, mp.role, mp.faction, mp.outcome, mp.survived, mp.death_day,
              u.username AS name
         FROM match_players mp
         LEFT JOIN users u ON u.id::text = mp.user_or_guest_id
        WHERE mp.match_id = $1
        ORDER BY mp.seat`,
      [matchId],
    );
    return {
      id: row.id,
      setupId: row.setup_id,
      outcome: row.outcome,
      startedAt: row.started_at.getTime(),
      endedAt: row.ended_at.getTime(),
      mode: row.mode,
      seats: seats.rows.map((s) => ({
        seat: s.seat,
        role: s.role,
        faction: s.faction,
        outcome: s.outcome,
        survived: s.survived,
        deathDay: s.death_day,
        name: s.name,
      })),
    };
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
         -- Only advance last_match_at for deltas that include a real played game
         -- (games_played > 0). A non-match award (e.g. a referral bonus, which is
         -- points-only) must NOT masquerade as the user's last match.
         last_match_at     = CASE WHEN EXCLUDED.games_played > 0
                                  THEN EXCLUDED.last_match_at
                                  ELSE user_stats.last_match_at END`,
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

  async rolloverSeason(newName: string): Promise<SeasonRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Close the current season (if any). Row-lock it so two concurrent
      // rollovers can't both proceed (the partial unique index also guards).
      const { rows: curRows } = await client.query<{ id: string }>(
        `SELECT id FROM seasons WHERE is_current FOR UPDATE`,
      );
      const oldSeasonId = curRows[0]?.id ?? null;
      if (oldSeasonId) {
        await client.query(
          `UPDATE seasons SET is_current = false, ended_at = now() WHERE id = $1`,
          [oldSeasonId],
        );
      }
      // Open the new current season.
      const { rows: newRows } = await client.query<{
        id: string;
        name: string;
        started_at: Date;
        ended_at: Date | null;
        is_current: boolean;
      }>(
        `INSERT INTO seasons (name, is_current) VALUES ($1, true)
         RETURNING id, name, started_at, ended_at, is_current`,
        [newName],
      );
      const newSeason = this.mapSeason(newRows[0] as never);
      // Soft-reset every rating from the old season into the new one (archive the
      // old rows under their season_id). games/wins reset for placements.
      if (oldSeasonId) {
        const { rows: ratings } = await client.query<{
          user_id: string;
          mode: string;
          mmr: number;
          rd: number;
          vol: number;
        }>(`SELECT user_id, mode, mmr, rd, vol FROM ratings WHERE season_id = $1`, [oldSeasonId]);
        for (const r of ratings) {
          const reset = softResetRating({ rating: r.mmr, rd: r.rd, vol: r.vol });
          await client.query(
            `INSERT INTO ratings (user_id, mode, season_id, mmr, rd, vol, games, wins, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0, now())
             ON CONFLICT (user_id, mode, season_id) DO NOTHING`,
            [r.user_id, r.mode, newSeason.id, reset.rating, reset.rd, reset.vol],
          );
        }
      }
      await client.query('COMMIT');
      return newSeason;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSeasons(limit: number): Promise<SeasonRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      started_at: Date;
      ended_at: Date | null;
      is_current: boolean;
    }>(
      `SELECT id, name, started_at, ended_at, is_current FROM seasons
       ORDER BY started_at DESC LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((r) => this.mapSeason(r));
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

  async getRatingLeaderboardPage(
    mode: string,
    seasonId: string,
    offset: number,
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
       ORDER BY r.mmr DESC, r.user_id ASC
       OFFSET $3 LIMIT $4`,
      [mode, seasonId, Math.max(0, offset), Math.max(1, Math.min(limit, 100))],
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

  async getRatingCount(mode: string, seasonId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::bigint AS n FROM ratings WHERE mode = $1 AND season_id = $2`,
      [mode, seasonId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async getRankPosition(userId: string, mode: string, seasonId: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ mmr: number }>(
      `SELECT mmr FROM ratings WHERE user_id = $1 AND mode = $2 AND season_id = $3`,
      [userId, mode, seasonId],
    );
    if (!rows[0]) return null;
    const { rows: countRows } = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::bigint AS n FROM ratings
       WHERE mode = $1 AND season_id = $2 AND mmr > $3`,
      [mode, seasonId, rows[0].mmr],
    );
    return Number(countRows[0]?.n ?? 0) + 1;
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
    if (rows.length === 0) return;
    // One multi-row parameterized INSERT instead of N round-trips (7 per match).
    // The VALUES list is built from the row index (8 columns each); ON CONFLICT
    // preserves the "ignore already-written (match,user)" semantics unchanged.
    const cols = 8;
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r, i) => {
      const base = i * cols;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
      );
      params.push(r.matchId, r.userId, r.mode, r.mmrBefore, r.mmrAfter, r.rdBefore, r.rdAfter, r.delta);
    });
    await this.pool.query(
      `INSERT INTO ranked_results
         (match_id, user_id, mode, mmr_before, mmr_after, rd_before, rd_after, delta)
       VALUES ${values.join(', ')}
       ON CONFLICT (match_id, user_id) DO NOTHING`,
      params,
    );
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

  // --- Social: profiles & presence -----------------------------------------

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query<{
      user_id: string;
      tagline: string | null;
      bio: string | null;
      accent: string | null;
      updated_at: Date;
    }>(
      `SELECT user_id, tagline, bio, accent, updated_at FROM profiles WHERE user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      userId: r.user_id,
      tagline: r.tagline,
      bio: r.bio,
      accent: r.accent,
      updatedAt: r.updated_at.getTime(),
    };
  }

  async upsertProfile(
    userId: string,
    fields: { tagline?: string | undefined; bio?: string | undefined; accent?: string | undefined },
  ): Promise<void> {
    // COALESCE keeps an existing column when the caller omits that field.
    await this.pool.query(
      `INSERT INTO profiles (user_id, tagline, bio, accent, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         tagline    = COALESCE($2, profiles.tagline),
         bio        = COALESCE($3, profiles.bio),
         accent     = COALESCE($4, profiles.accent),
         updated_at = now()`,
      [
        userId,
        fields.tagline ?? null,
        fields.bio ?? null,
        fields.accent ?? null,
      ],
    );
  }

  async touchPresence(userId: string, at: number): Promise<void> {
    await this.pool.query(`UPDATE users SET last_seen_at = to_timestamp($2 / 1000.0) WHERE id = $1`, [
      userId,
      at,
    ]);
  }

  async getLastSeen(userIds: string[]): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const id of userIds) out[id] = null;
    if (userIds.length === 0) return out;
    const { rows } = await this.pool.query<{ id: string; last_seen_at: Date | null }>(
      `SELECT id, last_seen_at FROM users WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    for (const r of rows) out[r.id] = r.last_seen_at ? r.last_seen_at.getTime() : null;
    return out;
  }

  // --- Social: friends ------------------------------------------------------

  async requestFriend(
    requesterId: string,
    addresseeId: string,
  ): Promise<'created' | 'exists' | 'accepted'> {
    // A reverse pending row (other → me) means this request accepts it.
    const reverse = await this.pool.query(
      `UPDATE friendships SET status = 'accepted', responded_at = now()
       WHERE requester_id = $2 AND addressee_id = $1 AND status = 'pending'`,
      [requesterId, addresseeId],
    );
    if ((reverse.rowCount ?? 0) > 0) return 'accepted';
    // Otherwise insert a fresh pending row; the unordered-pair unique index makes
    // a duplicate (either direction, any status) a no-op.
    const ins = await this.pool.query(
      `INSERT INTO friendships (id, requester_id, addressee_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
       DO NOTHING`,
      [newId(), requesterId, addresseeId],
    );
    return (ins.rowCount ?? 0) > 0 ? 'created' : 'exists';
  }

  async respondFriend(userId: string, friendshipId: string, accept: boolean): Promise<boolean> {
    if (accept) {
      const res = await this.pool.query(
        `UPDATE friendships SET status = 'accepted', responded_at = now()
         WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [friendshipId, userId],
      );
      return (res.rowCount ?? 0) > 0;
    }
    const res = await this.pool.query(
      `DELETE FROM friendships WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [friendshipId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async removeFriend(userId: string, otherId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [userId, otherId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listFriends(
    userId: string,
  ): Promise<Array<{ userId: string; username: string; lastSeen: number | null }>> {
    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      last_seen_at: Date | null;
    }>(
      `SELECT u.id, u.username, u.last_seen_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
       ORDER BY u.username`,
      [userId],
    );
    return rows.map((r) => ({
      userId: r.id,
      username: r.username,
      lastSeen: r.last_seen_at ? r.last_seen_at.getTime() : null,
    }));
  }

  async listFriendRequests(userId: string): Promise<{
    incoming: Array<{ id: string; userId: string; username: string; createdAt: number }>;
    outgoing: Array<{ id: string; userId: string; username: string; createdAt: number }>;
  }> {
    const incomingQ = await this.pool.query<{
      id: string;
      uid: string;
      username: string;
      created_at: Date;
    }>(
      `SELECT f.id, u.id AS uid, u.username, f.created_at
       FROM friendships f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    );
    const outgoingQ = await this.pool.query<{
      id: string;
      uid: string;
      username: string;
      created_at: Date;
    }>(
      `SELECT f.id, u.id AS uid, u.username, f.created_at
       FROM friendships f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    );
    const map = (r: { id: string; uid: string; username: string; created_at: Date }) => ({
      id: r.id,
      userId: r.uid,
      username: r.username,
      createdAt: r.created_at.getTime(),
    });
    return { incoming: incomingQ.rows.map(map), outgoing: outgoingQ.rows.map(map) };
  }

  async friendshipStatus(userId: string, otherId: string): Promise<FriendshipStatus> {
    const { rows } = await this.pool.query<{
      requester_id: string;
      status: string;
    }>(
      `SELECT requester_id, status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)
       LIMIT 1`,
      [userId, otherId],
    );
    const r = rows[0];
    if (!r) return 'none';
    if (r.status === 'accepted') return 'friends';
    return r.requester_id === userId ? 'pending_out' : 'pending_in';
  }

  // --- Social: chat rooms ---------------------------------------------------

  private mapRoom(r: {
    id: string;
    slug: string;
    name: string;
    topic: string;
    kind: string;
    sort: number;
    created_at: Date;
  }): ChatRoomRow {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      topic: r.topic,
      kind: r.kind,
      sort: r.sort,
      createdAt: r.created_at.getTime(),
    };
  }

  async listRooms(): Promise<ChatRoomRow[]> {
    // activeCount = distinct non-deleted posters in the last 10 minutes (an
    // "alive" signal, NOT true presence). Cheap via the (room_id, created_at)
    // index. LEFT JOIN LATERAL so a quiet room still returns 0.
    const { rows } = await this.pool.query<{
      id: string;
      slug: string;
      name: string;
      topic: string;
      kind: string;
      sort: number;
      created_at: Date;
      active_count: string | null;
    }>(
      `SELECT r.id, r.slug, r.name, r.topic, r.kind, r.sort, r.created_at,
              COALESCE(a.active_count, 0) AS active_count
       FROM chat_rooms r
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT m.user_id) AS active_count
         FROM room_messages m
         WHERE m.room_id = r.id
           AND m.deleted = false
           AND m.created_at > now() - interval '10 minutes'
       ) a ON true
       ORDER BY r.sort`,
    );
    return rows.map((r) => ({ ...this.mapRoom(r), activeCount: Number(r.active_count ?? 0) }));
  }

  async getRoomBySlug(slug: string): Promise<ChatRoomRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      slug: string;
      name: string;
      topic: string;
      kind: string;
      sort: number;
      created_at: Date;
    }>(
      `SELECT id, slug, name, topic, kind, sort, created_at FROM chat_rooms WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? this.mapRoom(rows[0]) : null;
  }

  async postRoomMessage(roomId: string, userId: string, body: string): Promise<RoomMessageRow> {
    const { rows } = await this.pool.query<{
      id: string;
      room_id: string;
      user_id: string;
      username: string;
      body: string;
      created_at: Date;
    }>(
      `WITH ins AS (
         INSERT INTO room_messages (id, room_id, user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, room_id, user_id, body, created_at
       )
       SELECT ins.id, ins.room_id, ins.user_id, u.username, ins.body, ins.created_at
       FROM ins JOIN users u ON u.id = ins.user_id`,
      [newId(), roomId, userId, body],
    );
    const r = rows[0] as NonNullable<(typeof rows)[0]>;
    return {
      id: r.id,
      roomId: r.room_id,
      userId: r.user_id,
      username: r.username,
      body: r.body,
      createdAt: r.created_at.getTime(),
    };
  }

  async listRoomMessages(
    roomId: string,
    opts: { limit: number; sinceId?: string; blocked?: string[] },
  ): Promise<
    Array<{
      id: string;
      userId: string;
      username: string;
      body: string;
      createdAt: number;
      deleted: boolean;
    }>
  > {
    const limit = Math.max(1, Math.min(opts.limit, 100));
    const blocked = opts.blocked && opts.blocked.length > 0 ? opts.blocked : null;
    // Newest `limit` (delta past sinceId if given), then return ascending.
    // Blocked authors are filtered server-side (uuid[] param). Deleted rows are
    // surfaced as tombstones (body nulled below).
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      username: string;
      body: string;
      created_at: Date;
      deleted: boolean;
    }>(
      `SELECT m.id, m.user_id, u.username, m.body, m.created_at, m.deleted
       FROM room_messages m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = $1
         AND ($3::uuid IS NULL OR m.created_at > (SELECT created_at FROM room_messages WHERE id = $3))
         AND ($4::uuid[] IS NULL OR NOT (m.user_id = ANY($4::uuid[])))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $2`,
      [roomId, limit, opts.sinceId ?? null, blocked],
    );
    return rows
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        body: r.deleted ? '' : r.body,
        createdAt: r.created_at.getTime(),
        deleted: r.deleted,
      }))
      .reverse();
  }

  async deleteRoomMessage(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<'ok' | 'forbidden' | 'not_found'> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM room_messages WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return 'not_found';
    if (!isAdmin && row.user_id !== requesterId) return 'forbidden';
    await this.pool.query(`UPDATE room_messages SET deleted = true WHERE id = $1`, [id]);
    return 'ok';
  }

  // --- Social: direct messages ---------------------------------------------

  private static dmOrder(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  async ensureDmThread(a: string, b: string): Promise<string> {
    const [lo, hi] = PgStore.dmOrder(a, b);
    const ins = await this.pool.query<{ id: string }>(
      `INSERT INTO dm_threads (id, user_lo, user_hi)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_lo, user_hi) DO NOTHING
       RETURNING id`,
      [newId(), lo, hi],
    );
    if (ins.rows[0]) return ins.rows[0].id;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM dm_threads WHERE user_lo = $1 AND user_hi = $2`,
      [lo, hi],
    );
    return (rows[0] as { id: string }).id;
  }

  async postDm(threadId: string, senderId: string, body: string): Promise<DmMessageRow> {
    const { rows } = await this.pool.query<{
      id: string;
      thread_id: string;
      sender_id: string;
      body: string;
      created_at: Date;
    }>(
      `INSERT INTO dm_messages (id, thread_id, sender_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, thread_id, sender_id, body, created_at`,
      [newId(), threadId, senderId, body],
    );
    const r = rows[0] as NonNullable<(typeof rows)[0]>;
    await this.pool.query(`UPDATE dm_threads SET last_at = $2 WHERE id = $1`, [
      threadId,
      r.created_at,
    ]);
    return {
      id: r.id,
      threadId: r.thread_id,
      senderId: r.sender_id,
      body: r.body,
      createdAt: r.created_at.getTime(),
    };
  }

  async listDmThreads(userId: string): Promise<DmThreadSummary[]> {
    // Preview reflects a tombstone when the latest message is soft-deleted.
    // unread = newer-than-last-read messages FROM the other party that are not
    // deleted. A missing dm_reads row means "never read" (epoch).
    const { rows } = await this.pool.query<{
      thread_id: string;
      other_id: string;
      other_username: string;
      last_at: Date;
      preview: string | null;
      preview_deleted: boolean | null;
      unread: string | null;
    }>(
      `SELECT t.id AS thread_id,
              other.id AS other_id,
              other.username AS other_username,
              t.last_at,
              last_msg.body AS preview,
              last_msg.deleted AS preview_deleted,
              (SELECT count(*) FROM dm_messages m
                 WHERE m.thread_id = t.id
                   AND m.sender_id <> $1
                   AND m.deleted = false
                   AND m.created_at > COALESCE(rd.last_read_at, 'epoch'::timestamptz)) AS unread
       FROM dm_threads t
       JOIN users other ON other.id = CASE WHEN t.user_lo = $1 THEN t.user_hi ELSE t.user_lo END
       LEFT JOIN dm_reads rd ON rd.thread_id = t.id AND rd.user_id = $1
       LEFT JOIN LATERAL (
         SELECT body, deleted FROM dm_messages m WHERE m.thread_id = t.id
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1
       ) last_msg ON true
       WHERE t.user_lo = $1 OR t.user_hi = $1
       ORDER BY t.last_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      threadId: r.thread_id,
      otherUserId: r.other_id,
      otherUsername: r.other_username,
      lastAt: r.last_at.getTime(),
      preview: r.preview_deleted ? '' : (r.preview ?? ''),
      unread: Number(r.unread ?? 0),
    }));
  }

  async listDmMessages(
    threadId: string,
    opts: { limit: number; sinceId?: string },
  ): Promise<
    Array<{ id: string; senderId: string; body: string; createdAt: number; deleted: boolean }>
  > {
    const limit = Math.max(1, Math.min(opts.limit, 100));
    const { rows } = await this.pool.query<{
      id: string;
      sender_id: string;
      body: string;
      created_at: Date;
      deleted: boolean;
    }>(
      `SELECT id, sender_id, body, created_at, deleted FROM dm_messages
       WHERE thread_id = $1
         AND ($3::uuid IS NULL OR created_at > (SELECT created_at FROM dm_messages WHERE id = $3))
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [threadId, limit, opts.sinceId ?? null],
    );
    return rows
      .map((r) => ({
        id: r.id,
        senderId: r.sender_id,
        body: r.deleted ? '' : r.body,
        createdAt: r.created_at.getTime(),
        deleted: r.deleted,
      }))
      .reverse();
  }

  async dmThreadParticipants(threadId: string): Promise<[string, string] | null> {
    const { rows } = await this.pool.query<{ user_lo: string; user_hi: string }>(
      `SELECT user_lo, user_hi FROM dm_threads WHERE id = $1`,
      [threadId],
    );
    const r = rows[0];
    return r ? [r.user_lo, r.user_hi] : null;
  }

  async markDmRead(userId: string, threadId: string, at: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO dm_reads (user_id, thread_id, last_read_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (user_id, thread_id)
       DO UPDATE SET last_read_at = GREATEST(dm_reads.last_read_at, EXCLUDED.last_read_at)`,
      [userId, threadId, at],
    );
  }

  async getTotalUnread(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ unread: string }>(
      `SELECT COALESCE(sum(c.unread), 0) AS unread
       FROM dm_threads t
       LEFT JOIN dm_reads rd ON rd.thread_id = t.id AND rd.user_id = $1
       LEFT JOIN LATERAL (
         SELECT count(*) AS unread FROM dm_messages m
         WHERE m.thread_id = t.id
           AND m.sender_id <> $1
           AND m.deleted = false
           AND m.created_at > COALESCE(rd.last_read_at, 'epoch'::timestamptz)
       ) c ON true
       WHERE t.user_lo = $1 OR t.user_hi = $1`,
      [userId],
    );
    return Number(rows[0]?.unread ?? 0);
  }

  async deleteDmMessage(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<'ok' | 'forbidden' | 'not_found'> {
    const { rows } = await this.pool.query<{ sender_id: string }>(
      `SELECT sender_id FROM dm_messages WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return 'not_found';
    if (!isAdmin && row.sender_id !== requesterId) return 'forbidden';
    await this.pool.query(`UPDATE dm_messages SET deleted = true WHERE id = $1`, [id]);
    return 'ok';
  }

  // --- Forums ---------------------------------------------------------------

  async listForumIndex(): Promise<ForumIndexCategory[]> {
    // One query joins boards to their category + per-board aggregates and the
    // latest post (thread title + author + time). Categories/boards order by sort.
    const { rows } = await this.pool.query<{
      category_slug: string;
      category_name: string;
      category_sort: number;
      board_slug: string | null;
      board_name: string | null;
      board_description: string | null;
      board_sort: number | null;
      thread_count: string | null;
      post_count: string | null;
      last_thread_id: string | null;
      last_thread_title: string | null;
      last_post_at: Date | null;
      last_post_username: string | null;
    }>(
      // Per-board thread/post counts come from ONE grouped aggregate over
      // forum_threads (a single LEFT JOIN), not two correlated subqueries per
      // board row (the N+2 the audit flagged). The latest post per board stays a
      // LEFT JOIN LATERAL (one indexed lookup per board). Return shape unchanged.
      `SELECT
         c.slug AS category_slug,
         c.name AS category_name,
         c.sort AS category_sort,
         b.slug AS board_slug,
         b.name AS board_name,
         b.description AS board_description,
         b.sort AS board_sort,
         COALESCE(tc.thread_count, 0) AS thread_count,
         COALESCE(tc.post_count, 0) AS post_count,
         lp.thread_id AS last_thread_id,
         lp.thread_title AS last_thread_title,
         lp.created_at AS last_post_at,
         lp.username AS last_post_username
       FROM forum_categories c
       LEFT JOIN forum_boards b ON b.category_id = c.id
       LEFT JOIN (
         SELECT t.board_id,
                count(*) AS thread_count,
                COALESCE(sum(t.post_count), 0) AS post_count
         FROM forum_threads t
         GROUP BY t.board_id
       ) tc ON tc.board_id = b.id
       LEFT JOIN LATERAL (
         SELECT p.created_at, t.id AS thread_id, t.title AS thread_title, u.username
         FROM forum_posts p
         JOIN forum_threads t ON t.id = p.thread_id
         JOIN users u ON u.id = p.author_id
         WHERE t.board_id = b.id
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1
       ) lp ON true
       ORDER BY c.sort, b.sort`,
    );
    const byCategory = new Map<string, ForumIndexCategory>();
    const order: string[] = [];
    for (const r of rows) {
      let cat = byCategory.get(r.category_slug);
      if (!cat) {
        cat = {
          category: { slug: r.category_slug, name: r.category_name, sort: r.category_sort },
          boards: [],
        };
        byCategory.set(r.category_slug, cat);
        order.push(r.category_slug);
      }
      if (r.board_slug === null) continue; // category with no boards
      const board: ForumIndexBoard = {
        slug: r.board_slug,
        name: r.board_name ?? '',
        description: r.board_description ?? '',
        sort: r.board_sort ?? 0,
        threadCount: Number(r.thread_count ?? 0),
        postCount: Number(r.post_count ?? 0),
        lastPost:
          r.last_thread_id && r.last_post_at
            ? {
                threadId: r.last_thread_id,
                threadTitle: r.last_thread_title ?? '',
                at: r.last_post_at.getTime(),
                username: r.last_post_username ?? '',
              }
            : null,
      };
      cat.boards.push(board);
    }
    return order.map((slug) => byCategory.get(slug) as ForumIndexCategory);
  }

  private mapBoard(r: {
    id: string;
    category_id: string;
    slug: string;
    name: string;
    description: string;
    sort: number;
    created_at: Date;
  }): ForumBoardRow {
    return {
      id: r.id,
      categoryId: r.category_id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      sort: r.sort,
      createdAt: r.created_at.getTime(),
    };
  }

  async getBoardBySlug(slug: string): Promise<ForumBoardRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      category_id: string;
      slug: string;
      name: string;
      description: string;
      sort: number;
      created_at: Date;
    }>(
      `SELECT id, category_id, slug, name, description, sort, created_at
       FROM forum_boards WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? this.mapBoard(rows[0]) : null;
  }

  async listThreads(
    boardId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ threads: ForumThreadListRow[]; total: number }> {
    const limit = Math.max(1, Math.min(opts.limit, 50));
    const offset = Math.max(0, opts.offset);
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      author_id: string;
      author_name: string;
      locked: boolean;
      pinned: boolean;
      views: number;
      post_count: number;
      created_at: Date;
      last_post_at: Date;
      last_poster_name: string | null;
    }>(
      `SELECT t.id, t.title, t.author_id, au.username AS author_name,
              t.locked, t.pinned, t.views, t.post_count, t.created_at, t.last_post_at,
              lpu.username AS last_poster_name
       FROM forum_threads t
       JOIN users au ON au.id = t.author_id
       LEFT JOIN users lpu ON lpu.id = t.last_poster_id
       WHERE t.board_id = $1
       ORDER BY t.pinned DESC, t.last_post_at DESC
       LIMIT $2 OFFSET $3`,
      [boardId, limit, offset],
    );
    const totalQ = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM forum_threads WHERE board_id = $1`,
      [boardId],
    );
    const threads = rows.map((r) => ({
      id: r.id,
      title: r.title,
      authorId: r.author_id,
      authorName: r.author_name,
      locked: r.locked,
      pinned: r.pinned,
      views: r.views,
      postCount: r.post_count,
      createdAt: r.created_at.getTime(),
      lastPostAt: r.last_post_at.getTime(),
      lastPosterName: r.last_poster_name,
    }));
    return { threads, total: Number(totalQ.rows[0]?.count ?? 0) };
  }

  async createThread(
    boardId: string,
    authorId: string,
    title: string,
    body: string,
  ): Promise<{ threadId: string; postId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const threadId = newId();
      const postId = newId();
      await client.query(
        `INSERT INTO forum_threads
           (id, board_id, author_id, title, post_count, last_poster_id)
         VALUES ($1, $2, $3, $4, 1, $3)`,
        [threadId, boardId, authorId, title],
      );
      await client.query(
        `INSERT INTO forum_posts (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`,
        [postId, threadId, authorId, body],
      );
      await client.query('COMMIT');
      return { threadId, postId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getThread(threadId: string): Promise<ForumThreadView | null> {
    const { rows } = await this.pool.query<{
      id: string;
      board_id: string;
      board_slug: string;
      board_name: string;
      title: string;
      author_id: string;
      author_name: string;
      locked: boolean;
      pinned: boolean;
      views: number;
      post_count: number;
      created_at: Date;
    }>(
      `SELECT t.id, t.board_id, b.slug AS board_slug, b.name AS board_name, t.title,
              t.author_id, au.username AS author_name,
              t.locked, t.pinned, t.views, t.post_count, t.created_at
       FROM forum_threads t
       JOIN forum_boards b ON b.id = t.board_id
       JOIN users au ON au.id = t.author_id
       WHERE t.id = $1`,
      [threadId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      boardId: r.board_id,
      boardSlug: r.board_slug,
      boardName: r.board_name,
      title: r.title,
      authorId: r.author_id,
      authorName: r.author_name,
      locked: r.locked,
      pinned: r.pinned,
      views: r.views,
      postCount: r.post_count,
      createdAt: r.created_at.getTime(),
    };
  }

  async incrementThreadViews(threadId: string): Promise<void> {
    await this.pool.query(`UPDATE forum_threads SET views = views + 1 WHERE id = $1`, [threadId]);
  }

  async listPosts(
    threadId: string,
    opts: { limit: number; offset: number; blocked?: string[] },
  ): Promise<{ posts: ForumPostRow[]; total: number }> {
    const limit = Math.max(1, Math.min(opts.limit, 50));
    const offset = Math.max(0, opts.offset);
    // Blocked authors are filtered from BOTH the page and the total (so the
    // viewer's pagination stays consistent). Deleted posts remain (tombstoned).
    const blocked = opts.blocked && opts.blocked.length > 0 ? opts.blocked : null;
    const { rows } = await this.pool.query<{
      id: string;
      author_id: string;
      author_name: string;
      author_joined: Date | null;
      body: string;
      created_at: Date;
      edited_at: Date | null;
      deleted: boolean;
    }>(
      `SELECT p.id, p.author_id, u.username AS author_name, u.created_at AS author_joined,
              p.body, p.created_at, p.edited_at, p.deleted
       FROM forum_posts p
       JOIN users u ON u.id = p.author_id
       WHERE p.thread_id = $1
         AND ($4::uuid[] IS NULL OR NOT (p.author_id = ANY($4::uuid[])))
       ORDER BY p.created_at, p.id
       LIMIT $2 OFFSET $3`,
      [threadId, limit, offset, blocked],
    );
    const totalQ = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM forum_posts
       WHERE thread_id = $1
         AND ($2::uuid[] IS NULL OR NOT (author_id = ANY($2::uuid[])))`,
      [threadId, blocked],
    );
    const posts = rows.map((r) => ({
      id: r.id,
      authorId: r.author_id,
      authorName: r.author_name,
      authorJoined: r.author_joined ? r.author_joined.getTime() : null,
      body: r.deleted ? '' : r.body,
      createdAt: r.created_at.getTime(),
      editedAt: r.edited_at ? r.edited_at.getTime() : null,
      deleted: r.deleted,
    }));
    return { posts, total: Number(totalQ.rows[0]?.count ?? 0) };
  }

  async createPost(
    threadId: string,
    authorId: string,
    body: string,
  ): Promise<{ postId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the thread row; bail (null) if it is missing or locked.
      const t = await client.query<{ locked: boolean }>(
        `SELECT locked FROM forum_threads WHERE id = $1 FOR UPDATE`,
        [threadId],
      );
      const row = t.rows[0];
      if (!row || row.locked) {
        await client.query('ROLLBACK');
        return null;
      }
      const postId = newId();
      const ins = await client.query<{ created_at: Date }>(
        `INSERT INTO forum_posts (id, thread_id, author_id, body)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [postId, threadId, authorId, body],
      );
      await client.query(
        `UPDATE forum_threads
         SET post_count = post_count + 1, last_post_at = $2, last_poster_id = $3
         WHERE id = $1`,
        [threadId, ins.rows[0]?.created_at, authorId],
      );
      await client.query('COMMIT');
      return { postId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async editPost(
    postId: string,
    editorId: string,
    isAdmin: boolean,
    body: string,
  ): Promise<boolean> {
    // Only the author (or an admin) may edit; sets edited_at.
    const res = isAdmin
      ? await this.pool.query(
          `UPDATE forum_posts SET body = $2, edited_at = now() WHERE id = $1`,
          [postId, body],
        )
      : await this.pool.query(
          `UPDATE forum_posts SET body = $3, edited_at = now()
           WHERE id = $1 AND author_id = $2`,
          [postId, editorId, body],
        );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteForumPost(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<'ok' | 'forbidden' | 'not_found'> {
    const { rows } = await this.pool.query<{ author_id: string }>(
      `SELECT author_id FROM forum_posts WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return 'not_found';
    if (!isAdmin && row.author_id !== requesterId) return 'forbidden';
    // The thread persists (post_count untouched); only this post is tombstoned.
    await this.pool.query(`UPDATE forum_posts SET deleted = true WHERE id = $1`, [id]);
    return 'ok';
  }

  async setThreadFlags(
    threadId: string,
    flags: { locked?: boolean; pinned?: boolean },
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [threadId];
    if (flags.locked !== undefined) {
      params.push(flags.locked);
      sets.push(`locked = $${params.length}`);
    }
    if (flags.pinned !== undefined) {
      params.push(flags.pinned);
      sets.push(`pinned = $${params.length}`);
    }
    if (sets.length === 0) {
      // No-op flags: just confirm the thread exists.
      const { rowCount } = await this.pool.query(`SELECT 1 FROM forum_threads WHERE id = $1`, [
        threadId,
      ]);
      return (rowCount ?? 0) > 0;
    }
    const res = await this.pool.query(
      `UPDATE forum_threads SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    return (res.rowCount ?? 0) > 0;
  }

  async searchForum(q: string, limit: number): Promise<ForumSearchHit[]> {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    const cap = Math.max(1, Math.min(limit, 30));
    // Match `q` LITERALLY: escape LIKE wildcards and pass the pattern as a bound
    // parameter (no injection). `title`/`body` are plain `text`, so we use ILIKE
    // for case-insensitivity. Soft-deleted posts are excluded from the body
    // search. We UNION title-matches (snippet = title) with post-matches
    // (snippet = the post head) and take the newest `cap` across both.
    const like = `%${PgStore.likeEscape(trimmed)}%`;
    const { rows } = await this.pool.query<{
      thread_id: string;
      thread_title: string;
      board_slug: string;
      board_name: string;
      snippet: string;
      matched_in: 'title' | 'post';
      created_at: Date;
    }>(
      `(
         SELECT t.id AS thread_id, t.title AS thread_title,
                b.slug AS board_slug, b.name AS board_name,
                t.title AS snippet, 'title'::text AS matched_in, t.created_at
         FROM forum_threads t
         JOIN forum_boards b ON b.id = t.board_id
         WHERE t.title ILIKE $1 ESCAPE '\\'
       )
       UNION ALL
       (
         SELECT t.id AS thread_id, t.title AS thread_title,
                b.slug AS board_slug, b.name AS board_name,
                left(p.body, 160) AS snippet, 'post'::text AS matched_in, p.created_at
         FROM forum_posts p
         JOIN forum_threads t ON t.id = p.thread_id
         JOIN forum_boards b ON b.id = t.board_id
         WHERE p.deleted = false
           AND p.body ILIKE $1 ESCAPE '\\'
       )
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, cap],
    );
    return rows.map((r) => ({
      threadId: r.thread_id,
      threadTitle: r.thread_title,
      boardSlug: r.board_slug,
      boardName: r.board_name,
      snippet: r.snippet,
      matchedIn: r.matched_in,
      createdAt: r.created_at.getTime(),
    }));
  }

  // --- Notifications center (QoL wave) -------------------------------------

  async createNotification(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // We do NOT prune on insert (keeping it simple per the spec): reads cap at
    // 50 via LIMIT, the unread count uses a partial index, and a future cron can
    // age out read rows >30d. Both indexes keep these queries cheap regardless.
    await this.pool.query(
      `INSERT INTO notifications (id, user_id, type, payload) VALUES ($1, $2, $3, $4)`,
      [newId(), userId, type, JSON.stringify(payload ?? {})],
    );
  }

  async listNotifications(userId: string, limit: number): Promise<NotificationRow[]> {
    const cap = Math.max(1, Math.min(Math.floor(limit) || 50, 50));
    const { rows } = await this.pool.query<{
      id: string;
      type: string;
      payload: unknown;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, type, payload, created_at, read_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [userId, cap],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      payload:
        r.payload && typeof r.payload === 'object'
          ? (r.payload as Record<string, unknown>)
          : {},
      createdAt: r.created_at.getTime(),
      readAt: r.read_at ? r.read_at.getTime() : null,
    }));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
    if (ids && ids.length > 0) {
      await this.pool.query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
        [userId, ids],
      );
    } else if (!ids) {
      // Omitted → mark all read. (An explicit empty array marks nothing.)
      await this.pool.query(
        `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
    }
    return this.getUnreadNotificationCount(userId);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Connectivity probe (Task D): a trivial round-trip; throws if unreachable. */
  async healthCheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

// Re-export type to keep the report category narrow in pg-store.
type ReportCategory = ReportRow['category'];
export type { ReportCategory };
