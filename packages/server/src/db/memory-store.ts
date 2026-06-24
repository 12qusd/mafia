/**
 * In-memory Store for NO_DB=1 mode (BUILD_SPEC §10).
 *
 * Guests only, no persistence. Registration is rejected (guests-only). Used for
 * dev/bots/CI so the server starts without Postgres. Sessions/mutes live only
 * for the process lifetime; match writes are dropped.
 */

import { softResetRating, type GameSetup } from '@nocturne/shared';
import { newId } from '../ids.js';
import { log } from '../log.js';
import { DEFAULT_ROOMS } from './default-rooms.js';
import { DEFAULT_FORUM } from './default-forum.js';
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
  ForumThreadListRow,
  ForumThreadView,
  ForumPostRow,
} from './types.js';

/** Internal friendship record (one per unordered pair). */
interface MemFriendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  createdAt: number;
  respondedAt: number | null;
}

/** Internal DM thread record (canonical lo<hi ordering). */
interface MemDmThread {
  id: string;
  userLo: string;
  userHi: string;
  lastAt: number;
}

/** Internal forum category record. */
interface MemForumCategory {
  id: string;
  slug: string;
  name: string;
  sort: number;
}

/** Internal forum thread record (last_post_* track most-recent activity). */
interface MemForumThread {
  id: string;
  boardId: string;
  authorId: string;
  title: string;
  locked: boolean;
  pinned: boolean;
  views: number;
  postCount: number;
  createdAt: number;
  lastPostAt: number;
  lastPosterId: string | null;
}

/** Internal forum post record. */
interface MemForumPost {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

export class MemoryStore implements Store {
  readonly persistent = false;
  private readonly sessions = new Map<string, { userId: string; expiresAt: number }>();
  private readonly mutes = new Map<string, Set<string>>();
  private readonly reports: ReportRow[] = [];
  private readonly sanctions: SanctionRow[] = [];
  /** In-memory points/achievements (process-lifetime only; guests excluded). */
  private readonly stats = new Map<string, UserStatsRow>();
  private readonly achievementsByUser = new Map<string, Set<string>>();
  /** In-process custom setups (process-lifetime only). */
  private readonly customSetups = new Map<string, CustomSetupRow>();
  /**
   * In-process match records (process-lifetime only). Kept so the public,
   * FINISHED-only retention surfaces (getRecentMatches / getPublicMatchSummary)
   * can be exercised under NO_DB; the full replay path still drops these.
   */
  private readonly matches = new Map<string, MatchRecord>();
  /** In-process ranked state (process-lifetime only; guests excluded upstream). */
  private currentSeason: SeasonRow | null = null;
  /** All seasons ever opened (archive; newest pushed last). */
  private readonly seasons: SeasonRow[] = [];
  private readonly ratings = new Map<string, RatingRow>();
  private readonly rolePrefs = new Map<string, Map<string, RolePreference['preference']>>();
  private readonly rankedResults: RankedResultInput[] = [];
  // --- Social (process-lifetime only) --------------------------------------
  private readonly profiles = new Map<string, ProfileRow>();
  private readonly lastSeen = new Map<string, number>();
  private readonly friendships: MemFriendship[] = [];
  private readonly rooms: ChatRoomRow[] = [];
  private readonly roomMessages: RoomMessageRow[] = [];
  private readonly dmThreads: MemDmThread[] = [];
  private readonly dmMessages: DmMessageRow[] = [];
  // --- Forums (process-lifetime only) --------------------------------------
  private readonly forumCategories: MemForumCategory[] = [];
  private readonly forumBoards: ForumBoardRow[] = [];
  private readonly forumThreads: MemForumThread[] = [];
  private readonly forumPosts: MemForumPost[] = [];
  /** Optional per-user join dates so forum posts can carry authorJoined in tests. */
  private readonly userJoined = new Map<string, number>();
  /** Monotonic clock so same-millisecond posts keep a stable, increasing order. */
  private clockSeq = 0;

  constructor() {
    log.warn('NO_DB mode: running guests-only with no persistence (§10).');
    // Seed the same default chat rooms the SQL schema seeds, so /api/rooms works
    // identically in NO_DB/guests-only mode (Social feature).
    const now = Date.now();
    for (const r of DEFAULT_ROOMS) {
      this.rooms.push({
        id: newId(),
        slug: r.slug,
        name: r.name,
        topic: r.topic,
        kind: r.kind,
        sort: r.sort,
        createdAt: now,
      });
    }
    // Seed the same default forum categories + boards the SQL schema seeds, so
    // the forum index works identically in NO_DB/guests-only mode (Forums feature).
    for (const c of DEFAULT_FORUM) {
      const categoryId = newId();
      this.forumCategories.push({ id: categoryId, slug: c.slug, name: c.name, sort: c.sort });
      for (const b of c.boards) {
        this.forumBoards.push({
          id: newId(),
          categoryId,
          slug: b.slug,
          name: b.name,
          description: b.description,
          sort: b.sort,
          createdAt: now,
        });
      }
    }
  }

  /**
   * Best-effort username for a user id. MemoryStore is guests-only (no user
   * table), so social rows store the id; we resolve a name from any recorded
   * profile/registry or fall back to a short id-derived handle (mirrors nameOf).
   */
  private nameFor(userId: string): string {
    return this.usernames.get(userId) ?? userId;
  }
  /** Optional name registry so unit tests can attach readable usernames. */
  private readonly usernames = new Map<string, string>();
  /** Test/seed helper: associate a display name with a synthetic user id. */
  setUsernameForTest(userId: string, username: string): void {
    this.usernames.set(userId, username);
  }
  /** Test/seed helper: record a join date (epoch ms) for a synthetic user id. */
  setUserJoinedForTest(userId: string, at: number): void {
    this.userJoined.set(userId, at);
  }

  /**
   * A strictly-increasing timestamp (epoch ms, but never repeating within a
   * process). Postgres orders ties by created_at + id; in-memory we keep the
   * same observable ordering without depending on sub-ms wall-clock resolution.
   */
  private now(): number {
    const t = Date.now();
    this.clockSeq = t > this.clockSeq ? t : this.clockSeq + 1;
    return this.clockSeq;
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
  async getUserByEmail(): Promise<UserRow | null> {
    return null;
  }
  async setLastLogin(): Promise<void> {}

  // Account lifecycle (retention wave): persistent-only. NO_DB has no accounts,
  // so these are inert — the routes gate on store.persistent before calling.
  async createPasswordReset(): Promise<void> {}
  async getPasswordReset(): Promise<PasswordResetRow | null> {
    return null;
  }
  async markPasswordResetUsed(): Promise<void> {}
  async updateUserPassword(): Promise<void> {}
  async revokeAllSessions(): Promise<void> {}
  async createEmailVerification(): Promise<void> {}
  async consumeEmailVerification(): Promise<string | null> {
    return null;
  }
  async setEmailVerified(): Promise<void> {}

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
  async getSession(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: number } | null> {
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return { userId: s.userId, expiresAt: s.expiresAt };
  }
  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    const s = this.sessions.get(tokenHash);
    if (s) s.expiresAt = expiresAt;
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

  async writeMatch(record: MatchRecord): Promise<void> {
    // Retained in-process (process-lifetime only) so the public FINISHED-only
    // retention surfaces work under NO_DB. The full replay path still drops it.
    this.matches.set(record.id, record);
  }
  async getMatchReplay(_matchId: string): Promise<MatchReplay | null> {
    return null; // matches are not persisted for replay/export in NO_DB mode.
  }
  async getMatchParticipants(_matchId: string): Promise<string[]> {
    return [];
  }

  // --- Public retention surfaces (FINISHED-only, no auth) -------------------

  /**
   * Test/seed helper: insert a match record directly. `endedAt: null` records an
   * IN-PROGRESS match (its roles must never leak via the public surfaces); a
   * non-null `endedAt` records a finished one. Mirrors what writeMatch stores.
   */
  setMatchForTest(
    record: Omit<MatchRecord, 'endedAt'> & { endedAt: number | null },
  ): void {
    // Cast through the shared shape; the public reads below honour a null
    // endedAt as "in progress" regardless of the MatchRecord.endedAt typing.
    this.matches.set(record.id, record as unknown as MatchRecord);
  }

  async getRecentMatches(limit: number): Promise<RecentMatchSummary[]> {
    const cap = Math.max(1, Math.min(Math.floor(limit) || 0, 30));
    return [...this.matches.values()]
      // Leak-safety: FINISHED matches only (a null/absent endedAt is in-progress).
      .filter((m) => m.endedAt !== null && m.endedAt !== undefined)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, cap)
      .map((m) => ({
        id: m.id,
        setupId: m.setupId,
        outcome: m.outcome ?? null,
        endedAt: m.endedAt,
        mode: m.mode ?? null,
        players: m.players.length,
      }));
  }

  async getPublicMatchSummary(matchId: string): Promise<PublicMatchSummary | null> {
    const m = this.matches.get(matchId);
    // Leak-safety: unknown id OR an in-progress match (null endedAt) ⇒ null.
    if (!m || m.endedAt === null || m.endedAt === undefined) return null;
    const seats = [...m.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        role: p.role,
        faction: p.faction,
        outcome: p.outcome,
        survived: p.survived,
        deathDay: p.deathDay,
        // MemoryStore has no users table; resolve a test-supplied name if any.
        name: this.usernames.get(p.userOrGuestId) ?? null,
      }));
    return {
      id: m.id,
      setupId: m.setupId,
      outcome: m.outcome ?? null,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      mode: m.mode ?? null,
      seats,
    };
  }

  async addToUserStats(userId: string, delta: StatsDelta, at: number): Promise<void> {
    const cur = this.stats.get(userId) ?? {
      userId,
      totalPoints: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesSurvived: 0,
      daysDeadWatched: 0,
      lastMatchAt: null,
    };
    this.stats.set(userId, {
      userId,
      totalPoints: cur.totalPoints + delta.points,
      gamesPlayed: cur.gamesPlayed + delta.gamesPlayed,
      gamesWon: cur.gamesWon + delta.gamesWon,
      gamesSurvived: cur.gamesSurvived + delta.gamesSurvived,
      daysDeadWatched: cur.daysDeadWatched + delta.daysDeadWatched,
      lastMatchAt: at,
    });
  }
  async recordPoints(_userId: string, _awards: PointAwardRecord[]): Promise<void> {
    // Ledger not retained in NO_DB mode.
  }
  async unlockAchievements(
    userId: string,
    items: { key: string; points: number }[],
  ): Promise<string[]> {
    let set = this.achievementsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.achievementsByUser.set(userId, set);
    }
    const newly: string[] = [];
    for (const it of items) {
      if (!set.has(it.key)) {
        set.add(it.key);
        newly.push(it.key);
      }
    }
    return newly;
  }
  async getUserStats(userId: string): Promise<UserStatsRow | null> {
    return this.stats.get(userId) ?? null;
  }
  async getUserAchievements(userId: string): Promise<string[]> {
    return [...(this.achievementsByUser.get(userId) ?? [])];
  }
  async getLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    return [...this.stats.values()]
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((s) => ({
        userId: s.userId,
        username: s.userId,
        totalPoints: s.totalPoints,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
      }));
  }
  async upsertDailyRollup(): Promise<void> {}

  async createCustomSetup(
    ownerUserId: string,
    name: string,
    setup: GameSetup,
  ): Promise<CustomSetupRow> {
    const row: CustomSetupRow = {
      id: `custom:${newId()}`,
      ownerUserId,
      name,
      // Clone so later mutation of the caller's object cannot bleed in.
      setup: JSON.parse(JSON.stringify(setup)) as GameSetup,
      createdAt: Date.now(),
    };
    this.customSetups.set(row.id, row);
    return row;
  }
  async getCustomSetup(id: string): Promise<CustomSetupRow | null> {
    return this.customSetups.get(id) ?? null;
  }
  async listCustomSetups(ownerUserId: string): Promise<CustomSetupRow[]> {
    return [...this.customSetups.values()]
      .filter((r) => r.ownerUserId === ownerUserId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async deleteCustomSetup(id: string, ownerUserId: string): Promise<boolean> {
    const row = this.customSetups.get(id);
    if (!row || row.ownerUserId !== ownerUserId) return false;
    this.customSetups.delete(id);
    return true;
  }

  // --- Ranked play + role preferences (goal: ranked + preferences) ---------

  private ratingKey(userId: string, mode: string, seasonId: string): string {
    return `${userId} ${mode} ${seasonId}`;
  }

  async getCurrentSeason(): Promise<SeasonRow | null> {
    return this.currentSeason;
  }
  async ensureCurrentSeason(name: string): Promise<SeasonRow> {
    if (!this.currentSeason) {
      this.currentSeason = {
        id: newId(),
        name,
        startedAt: Date.now(),
        endedAt: null,
        isCurrent: true,
      };
      this.seasons.push(this.currentSeason);
    }
    return this.currentSeason;
  }
  async rolloverSeason(newName: string): Promise<SeasonRow> {
    const old = this.currentSeason;
    const now = Date.now();
    if (old) {
      old.isCurrent = false;
      old.endedAt = now;
    }
    const next: SeasonRow = {
      id: newId(),
      name: newName,
      startedAt: now,
      endedAt: null,
      isCurrent: true,
    };
    this.currentSeason = next;
    this.seasons.push(next);
    // Soft-reset every rating from the old season into the new one (old rows are
    // archived under their season id; new rows reset games/wins for placements).
    if (old) {
      for (const r of [...this.ratings.values()]) {
        if (r.seasonId !== old.id) continue;
        const reset = softResetRating({ rating: r.mmr, rd: r.rd, vol: r.vol });
        const key = this.ratingKey(r.userId, r.mode, next.id);
        if (!this.ratings.has(key)) {
          this.ratings.set(key, {
            userId: r.userId,
            mode: r.mode,
            seasonId: next.id,
            mmr: reset.rating,
            rd: reset.rd,
            vol: reset.vol,
            games: 0,
            wins: 0,
            updatedAt: now,
          });
        }
      }
    }
    return next;
  }
  async getSeasons(limit: number): Promise<SeasonRow[]> {
    return this.seasons
      .slice()
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((s) => ({ ...s }));
  }
  async getRating(userId: string, mode: string, seasonId: string): Promise<RatingRow | null> {
    return this.ratings.get(this.ratingKey(userId, mode, seasonId)) ?? null;
  }
  async upsertRating(row: RatingRow): Promise<void> {
    this.ratings.set(this.ratingKey(row.userId, row.mode, row.seasonId), {
      ...row,
      updatedAt: Date.now(),
    });
  }
  async getRatingLeaderboard(
    mode: string,
    seasonId: string,
    limit: number,
  ): Promise<RatingLeaderboardEntry[]> {
    return [...this.ratings.values()]
      .filter((r) => r.mode === mode && r.seasonId === seasonId)
      .sort((a, b) => b.mmr - a.mmr)
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((r) => ({
        userId: r.userId,
        username: r.userId,
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
    return [...this.ratings.values()]
      .filter((r) => r.mode === mode && r.seasonId === seasonId)
      // Stable tiebreak on user id to mirror the SQL ORDER BY (deterministic page).
      .sort((a, b) => b.mmr - a.mmr || a.userId.localeCompare(b.userId))
      .slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, Math.min(limit, 100)))
      .map((r) => ({
        userId: r.userId,
        username: r.userId,
        mmr: r.mmr,
        rd: r.rd,
        games: r.games,
        wins: r.wins,
      }));
  }
  async getRatingCount(mode: string, seasonId: string): Promise<number> {
    let n = 0;
    for (const r of this.ratings.values()) if (r.mode === mode && r.seasonId === seasonId) n++;
    return n;
  }
  async getRankPosition(userId: string, mode: string, seasonId: string): Promise<number | null> {
    const self = this.ratings.get(this.ratingKey(userId, mode, seasonId));
    if (!self) return null;
    let higher = 0;
    for (const r of this.ratings.values()) {
      if (r.mode === mode && r.seasonId === seasonId && r.mmr > self.mmr) higher++;
    }
    return higher + 1;
  }
  async getRolePreferences(userId: string): Promise<RolePreference[]> {
    const m = this.rolePrefs.get(userId);
    if (!m) return [];
    return [...m.entries()]
      .map(([role, preference]) => ({ role, preference }))
      .sort((a, b) => a.role.localeCompare(b.role));
  }
  async setRolePreference(
    userId: string,
    role: string,
    preference: 'blacklist' | 'prefer' | null,
  ): Promise<void> {
    let m = this.rolePrefs.get(userId);
    if (preference === null) {
      m?.delete(role);
      return;
    }
    if (!m) {
      m = new Map();
      this.rolePrefs.set(userId, m);
    }
    m.set(role, preference);
  }
  async writeRankedResults(rows: RankedResultInput[]): Promise<void> {
    for (const r of rows) {
      const exists = this.rankedResults.some(
        (x) => x.matchId === r.matchId && x.userId === r.userId,
      );
      if (!exists) this.rankedResults.push({ ...r });
    }
  }
  async getRankedResults(userId: string, limit: number): Promise<RankedResultInput[]> {
    // Newest first: in-process inserts are append-order, so reverse.
    return this.rankedResults
      .filter((r) => r.userId === userId)
      .slice()
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((r) => ({ ...r }));
  }

  // --- Social: profiles & presence -----------------------------------------

  async getProfile(userId: string): Promise<ProfileRow | null> {
    return this.profiles.get(userId) ?? null;
  }
  async upsertProfile(
    userId: string,
    fields: { tagline?: string | undefined; bio?: string | undefined; accent?: string | undefined },
  ): Promise<void> {
    const cur = this.profiles.get(userId);
    this.profiles.set(userId, {
      userId,
      tagline: fields.tagline !== undefined ? fields.tagline : (cur?.tagline ?? null),
      bio: fields.bio !== undefined ? fields.bio : (cur?.bio ?? null),
      accent: fields.accent !== undefined ? fields.accent : (cur?.accent ?? null),
      updatedAt: Date.now(),
    });
  }
  async touchPresence(userId: string, at: number): Promise<void> {
    this.lastSeen.set(userId, at);
  }
  async getLastSeen(userIds: string[]): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const id of userIds) out[id] = this.lastSeen.get(id) ?? null;
    return out;
  }

  // --- Social: friends ------------------------------------------------------

  private findFriendship(a: string, b: string): MemFriendship | undefined {
    return this.friendships.find(
      (f) =>
        (f.requesterId === a && f.addresseeId === b) ||
        (f.requesterId === b && f.addresseeId === a),
    );
  }

  async requestFriend(
    requesterId: string,
    addresseeId: string,
  ): Promise<'created' | 'exists' | 'accepted'> {
    const existing = this.findFriendship(requesterId, addresseeId);
    if (existing) {
      if (existing.status === 'accepted') return 'exists';
      // A reverse pending row → accept it.
      if (existing.requesterId === addresseeId && existing.addresseeId === requesterId) {
        existing.status = 'accepted';
        existing.respondedAt = Date.now();
        return 'accepted';
      }
      // Same-direction pending row already there.
      return 'exists';
    }
    this.friendships.push({
      id: newId(),
      requesterId,
      addresseeId,
      status: 'pending',
      createdAt: Date.now(),
      respondedAt: null,
    });
    return 'created';
  }

  async respondFriend(userId: string, friendshipId: string, accept: boolean): Promise<boolean> {
    const idx = this.friendships.findIndex((f) => f.id === friendshipId);
    if (idx < 0) return false;
    const f = this.friendships[idx]!;
    // Only the addressee of a pending request may act.
    if (f.addresseeId !== userId || f.status !== 'pending') return false;
    if (accept) {
      f.status = 'accepted';
      f.respondedAt = Date.now();
    } else {
      this.friendships.splice(idx, 1);
    }
    return true;
  }

  async removeFriend(userId: string, otherId: string): Promise<boolean> {
    const idx = this.friendships.findIndex(
      (f) =>
        (f.requesterId === userId && f.addresseeId === otherId) ||
        (f.requesterId === otherId && f.addresseeId === userId),
    );
    if (idx < 0) return false;
    this.friendships.splice(idx, 1);
    return true;
  }

  async listFriends(
    userId: string,
  ): Promise<Array<{ userId: string; username: string; lastSeen: number | null }>> {
    return this.friendships
      .filter(
        (f) =>
          f.status === 'accepted' &&
          (f.requesterId === userId || f.addresseeId === userId),
      )
      .map((f) => {
        const other = f.requesterId === userId ? f.addresseeId : f.requesterId;
        return { userId: other, username: this.nameFor(other), lastSeen: this.lastSeen.get(other) ?? null };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  async listFriendRequests(userId: string): Promise<{
    incoming: Array<{ id: string; userId: string; username: string; createdAt: number }>;
    outgoing: Array<{ id: string; userId: string; username: string; createdAt: number }>;
  }> {
    const incoming = this.friendships
      .filter((f) => f.status === 'pending' && f.addresseeId === userId)
      .map((f) => ({
        id: f.id,
        userId: f.requesterId,
        username: this.nameFor(f.requesterId),
        createdAt: f.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    const outgoing = this.friendships
      .filter((f) => f.status === 'pending' && f.requesterId === userId)
      .map((f) => ({
        id: f.id,
        userId: f.addresseeId,
        username: this.nameFor(f.addresseeId),
        createdAt: f.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { incoming, outgoing };
  }

  async friendshipStatus(userId: string, otherId: string): Promise<FriendshipStatus> {
    const f = this.findFriendship(userId, otherId);
    if (!f) return 'none';
    if (f.status === 'accepted') return 'friends';
    return f.requesterId === userId ? 'pending_out' : 'pending_in';
  }

  // --- Social: chat rooms ---------------------------------------------------

  async listRooms(): Promise<ChatRoomRow[]> {
    return [...this.rooms].sort((a, b) => a.sort - b.sort).map((r) => ({ ...r }));
  }
  async getRoomBySlug(slug: string): Promise<ChatRoomRow | null> {
    const r = this.rooms.find((x) => x.slug === slug);
    return r ? { ...r } : null;
  }
  async postRoomMessage(roomId: string, userId: string, body: string): Promise<RoomMessageRow> {
    const row: RoomMessageRow = {
      id: newId(),
      roomId,
      userId,
      username: this.nameFor(userId),
      body,
      createdAt: this.now(),
    };
    this.roomMessages.push(row);
    return { ...row };
  }
  async listRoomMessages(
    roomId: string,
    opts: { limit: number; sinceId?: string },
  ): Promise<
    Array<{ id: string; userId: string; username: string; body: string; createdAt: number }>
  > {
    const limit = Math.max(1, Math.min(opts.limit, 100));
    // Insertion order is chronological; assign a stable sequence per row.
    const all = this.roomMessages.filter((m) => m.roomId === roomId);
    let slice = all;
    if (opts.sinceId) {
      const idx = all.findIndex((m) => m.id === opts.sinceId);
      slice = idx >= 0 ? all.slice(idx + 1) : all;
    }
    // Newest `limit`, ascending by time.
    const tail = slice.slice(Math.max(0, slice.length - limit));
    return tail.map((m) => ({
      id: m.id,
      userId: m.userId,
      username: this.nameFor(m.userId),
      body: m.body,
      createdAt: m.createdAt,
    }));
  }

  // --- Social: direct messages ---------------------------------------------

  private static dmOrder(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  async ensureDmThread(a: string, b: string): Promise<string> {
    const [lo, hi] = MemoryStore.dmOrder(a, b);
    let t = this.dmThreads.find((x) => x.userLo === lo && x.userHi === hi);
    if (!t) {
      t = { id: newId(), userLo: lo, userHi: hi, lastAt: this.now() };
      this.dmThreads.push(t);
    }
    return t.id;
  }
  async postDm(threadId: string, senderId: string, body: string): Promise<DmMessageRow> {
    const row: DmMessageRow = {
      id: newId(),
      threadId,
      senderId,
      body,
      createdAt: this.now(),
    };
    this.dmMessages.push(row);
    const t = this.dmThreads.find((x) => x.id === threadId);
    if (t) t.lastAt = row.createdAt;
    return { ...row };
  }
  async listDmThreads(userId: string): Promise<
    Array<{
      threadId: string;
      otherUserId: string;
      otherUsername: string;
      lastAt: number;
      preview: string;
    }>
  > {
    return this.dmThreads
      .filter((t) => t.userLo === userId || t.userHi === userId)
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((t) => {
        const other = t.userLo === userId ? t.userHi : t.userLo;
        const msgs = this.dmMessages.filter((m) => m.threadId === t.id);
        const last = msgs[msgs.length - 1];
        return {
          threadId: t.id,
          otherUserId: other,
          otherUsername: this.nameFor(other),
          lastAt: t.lastAt,
          preview: last?.body ?? '',
        };
      });
  }
  async listDmMessages(
    threadId: string,
    opts: { limit: number; sinceId?: string },
  ): Promise<Array<{ id: string; senderId: string; body: string; createdAt: number }>> {
    const limit = Math.max(1, Math.min(opts.limit, 100));
    const all = this.dmMessages.filter((m) => m.threadId === threadId);
    let slice = all;
    if (opts.sinceId) {
      const idx = all.findIndex((m) => m.id === opts.sinceId);
      slice = idx >= 0 ? all.slice(idx + 1) : all;
    }
    const tail = slice.slice(Math.max(0, slice.length - limit));
    return tail.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
    }));
  }
  async dmThreadParticipants(threadId: string): Promise<[string, string] | null> {
    const t = this.dmThreads.find((x) => x.id === threadId);
    return t ? [t.userLo, t.userHi] : null;
  }

  // --- Forums ---------------------------------------------------------------

  /** Most-recent post in a board (across all its threads), or null. */
  private latestPostForBoard(boardId: string): {
    threadId: string;
    threadTitle: string;
    at: number;
    username: string;
  } | null {
    const threadIds = new Set(
      this.forumThreads.filter((t) => t.boardId === boardId).map((t) => t.id),
    );
    let best: MemForumPost | null = null;
    for (const p of this.forumPosts) {
      if (!threadIds.has(p.threadId)) continue;
      if (!best || p.createdAt > best.createdAt) best = p;
    }
    if (!best) return null;
    const thread = this.forumThreads.find((t) => t.id === best!.threadId);
    if (!thread) return null;
    return {
      threadId: thread.id,
      threadTitle: thread.title,
      at: best.createdAt,
      username: this.nameFor(best.authorId),
    };
  }

  async listForumIndex(): Promise<ForumIndexCategory[]> {
    return [...this.forumCategories]
      .sort((a, b) => a.sort - b.sort)
      .map((c) => {
        const boards = this.forumBoards
          .filter((b) => b.categoryId === c.id)
          .sort((a, b) => a.sort - b.sort)
          .map((b) => {
            const threads = this.forumThreads.filter((t) => t.boardId === b.id);
            const postCount = threads.reduce((sum, t) => sum + t.postCount, 0);
            return {
              slug: b.slug,
              name: b.name,
              description: b.description,
              sort: b.sort,
              threadCount: threads.length,
              postCount,
              lastPost: this.latestPostForBoard(b.id),
            };
          });
        return { category: { slug: c.slug, name: c.name, sort: c.sort }, boards };
      });
  }

  async getBoardBySlug(slug: string): Promise<ForumBoardRow | null> {
    const b = this.forumBoards.find((x) => x.slug === slug);
    return b ? { ...b } : null;
  }

  async listThreads(
    boardId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ threads: ForumThreadListRow[]; total: number }> {
    const limit = Math.max(1, Math.min(opts.limit, 50));
    const offset = Math.max(0, opts.offset);
    const all = this.forumThreads
      .filter((t) => t.boardId === boardId)
      // Pinned first, then last_post_at desc.
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.lastPostAt - a.lastPostAt;
      });
    const total = all.length;
    const threads = all.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      title: t.title,
      authorId: t.authorId,
      authorName: this.nameFor(t.authorId),
      locked: t.locked,
      pinned: t.pinned,
      views: t.views,
      postCount: t.postCount,
      createdAt: t.createdAt,
      lastPostAt: t.lastPostAt,
      lastPosterName: t.lastPosterId ? this.nameFor(t.lastPosterId) : null,
    }));
    return { threads, total };
  }

  async createThread(
    boardId: string,
    authorId: string,
    title: string,
    body: string,
  ): Promise<{ threadId: string; postId: string }> {
    const at = this.now();
    const threadId = newId();
    const postId = newId();
    this.forumThreads.push({
      id: threadId,
      boardId,
      authorId,
      title,
      locked: false,
      pinned: false,
      views: 0,
      postCount: 1,
      createdAt: at,
      lastPostAt: at,
      lastPosterId: authorId,
    });
    this.forumPosts.push({ id: postId, threadId, authorId, body, createdAt: at, editedAt: null });
    return { threadId, postId };
  }

  async getThread(threadId: string): Promise<ForumThreadView | null> {
    const t = this.forumThreads.find((x) => x.id === threadId);
    if (!t) return null;
    const board = this.forumBoards.find((b) => b.id === t.boardId);
    return {
      id: t.id,
      boardId: t.boardId,
      boardSlug: board?.slug ?? '',
      boardName: board?.name ?? '',
      title: t.title,
      authorId: t.authorId,
      authorName: this.nameFor(t.authorId),
      locked: t.locked,
      pinned: t.pinned,
      views: t.views,
      postCount: t.postCount,
      createdAt: t.createdAt,
    };
  }

  async incrementThreadViews(threadId: string): Promise<void> {
    const t = this.forumThreads.find((x) => x.id === threadId);
    if (t) t.views += 1;
  }

  async listPosts(
    threadId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ posts: ForumPostRow[]; total: number }> {
    const limit = Math.max(1, Math.min(opts.limit, 50));
    const offset = Math.max(0, opts.offset);
    const all = this.forumPosts
      .filter((p) => p.threadId === threadId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const total = all.length;
    const posts = all.slice(offset, offset + limit).map((p) => ({
      id: p.id,
      authorId: p.authorId,
      authorName: this.nameFor(p.authorId),
      authorJoined: this.userJoined.get(p.authorId) ?? null,
      body: p.body,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
    }));
    return { posts, total };
  }

  async createPost(
    threadId: string,
    authorId: string,
    body: string,
  ): Promise<{ postId: string } | null> {
    const t = this.forumThreads.find((x) => x.id === threadId);
    if (!t || t.locked) return null;
    const at = this.now();
    const postId = newId();
    this.forumPosts.push({ id: postId, threadId, authorId, body, createdAt: at, editedAt: null });
    t.postCount += 1;
    t.lastPostAt = at;
    t.lastPosterId = authorId;
    return { postId };
  }

  async editPost(
    postId: string,
    editorId: string,
    isAdmin: boolean,
    body: string,
  ): Promise<boolean> {
    const p = this.forumPosts.find((x) => x.id === postId);
    if (!p) return false;
    if (!isAdmin && p.authorId !== editorId) return false;
    p.body = body;
    p.editedAt = this.now();
    return true;
  }

  async setThreadFlags(
    threadId: string,
    flags: { locked?: boolean; pinned?: boolean },
  ): Promise<boolean> {
    const t = this.forumThreads.find((x) => x.id === threadId);
    if (!t) return false;
    if (flags.locked !== undefined) t.locked = flags.locked;
    if (flags.pinned !== undefined) t.pinned = flags.pinned;
    return true;
  }

  async close(): Promise<void> {}

  /** No-op connectivity probe (Task D): the in-memory store is always reachable. */
  async healthCheck(): Promise<void> {}
}
