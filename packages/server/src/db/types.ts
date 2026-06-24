/**
 * Persistence interface (BUILD_SPEC §10). Two implementations satisfy it:
 * `PgStore` (Postgres via `pg`) and `MemoryStore` (NO_DB=1, guests-only dev/CI).
 *
 * The store is NOT touched in the per-message hot path (§2.2): the gateway uses
 * it only at login/lobby-join (ban/mute checks) and at match end (bulk write).
 */

import type { ReportCategory, GameSetup } from '@nocturne/shared';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  flags: number;
  /** Account creation time (epoch ms). Optional: not all read paths select it. */
  createdAt?: number;
  /** Whether the user's email is confirmed (account lifecycle). Optional: not
   *  every read path selects it. */
  emailVerified?: boolean;
}

/** A persisted password-reset token's state (account lifecycle). */
export interface PasswordResetRow {
  userId: string;
  /** Epoch ms the token expires. */
  expiresAt: number;
  used: boolean;
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

export interface MatchPlayerRecord {
  userOrGuestId: string;
  seat: number;
  role: string;
  faction: string;
  outcome: string;
  survived: boolean;
  /** 1-based in-game day the seat died, or null if they survived (§4). */
  deathDay: number | null;
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
  /** HMAC-SHA256 over the canonical record; replay-integrity proof (§9). */
  fingerprint: string;
  /** Queue the match was played in: casual | ranked | quickplay. Optional so the
   *  existing match-end caller (which omits it) still persists casual matches. */
  mode?: string;
  /** Ranked season the match counted toward, when {@link mode} is 'ranked'. */
  seasonId?: string;
  players: MatchPlayerRecord[];
  events: { seq: number; phase: string; event: unknown }[];
  chat: { seq: number; channel: string; senderSeat: number | null; body: string }[];
}

/** A persisted match read back for replay/export (§9). */
export interface MatchReplay {
  id: string;
  setupId: string;
  config: unknown;
  seed: string;
  startedAt: number;
  endedAt: number | null;
  outcome: string | null;
  serverBuild: string;
  fingerprint: string | null;
  players: MatchPlayerRecord[];
  events: { seq: number; phase: string; event: unknown }[];
  chat: { seq: number; channel: string; senderSeat: number | null; body: string }[];
}

/**
 * One row of the public "recent games" strip (retention front-end). Derived
 * ONLY from FINISHED matches (ended_at NOT NULL) — never an in-progress game,
 * so no live roles/seats leak. No auth required to read.
 */
export interface RecentMatchSummary {
  id: string;
  setupId: string;
  outcome: string | null;
  /** Epoch ms the match ended. Never null (finished-only). */
  endedAt: number;
  mode: string | null;
  /** Number of seats in the match (match_players count). */
  players: number;
}

/**
 * The public, no-auth match summary backing the shareable replay card. Returned
 * ONLY for a FINISHED match (ended_at NOT NULL); a finished game's roles are
 * already revealed at game-over, so exposing them post-hoc is safe. An
 * in-progress match yields null — its roles/seats must NEVER leak.
 */
export interface PublicMatchSummary {
  id: string;
  setupId: string;
  outcome: string | null;
  startedAt: number;
  /** Epoch ms the match ended. Never null (finished-only). */
  endedAt: number;
  mode: string | null;
  seats: Array<{
    seat: number;
    role: string;
    faction: string;
    outcome: string;
    survived: boolean;
    deathDay: number | null;
    /** Account username for the seat, or null for a guest/unknown id. */
    name: string | null;
  }>;
}

// --------------------------------------------------------------------------
// Points & achievements (goal: points system)
// --------------------------------------------------------------------------

export interface UserStatsRow {
  userId: string;
  totalPoints: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesSurvived: number;
  daysDeadWatched: number;
  lastMatchAt: number | null;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  totalPoints: number;
  gamesPlayed: number;
  gamesWon: number;
}

export interface PointAwardRecord {
  matchId: string | null;
  reason: string;
  detail: string | null;
  points: number;
}

/** Per-match increments applied to a user's lifetime stats. */
export interface StatsDelta {
  points: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesSurvived: number;
  daysDeadWatched: number;
}

// --------------------------------------------------------------------------
// Custom setups (custom setup builder)
// --------------------------------------------------------------------------

/** A user-built, server-validated role setup persisted for lobby creation. */
export interface CustomSetupRow {
  /** `custom:<uuid>` — namespaced so the lobby resolver can route it. */
  id: string;
  ownerUserId: string;
  name: string;
  setup: GameSetup;
  createdAt: number;
}

// --------------------------------------------------------------------------
// Ranked play + role-preference unlocks (goal: ranked + preferences)
// --------------------------------------------------------------------------

/** A ranked season. At most one row has `isCurrent` true at a time. */
export interface SeasonRow {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  isCurrent: boolean;
}

/** Per-user, per-mode, per-season Glicko-2 rating: mmr=rating, rd=deviation, vol=volatility. */
export interface RatingRow {
  userId: string;
  mode: string;
  seasonId: string;
  mmr: number;
  rd: number;
  vol: number;
  games: number;
  wins: number;
  updatedAt: number;
}

/** A user's preference for a role: avoid it ('blacklist') or favor it ('prefer'). */
export interface RolePreference {
  role: string;
  preference: 'blacklist' | 'prefer';
}

/** One per-match rating delta to append at match end (audit + match history). */
export interface RankedResultInput {
  matchId: string;
  userId: string;
  mode: string;
  mmrBefore: number;
  mmrAfter: number;
  rdBefore: number;
  rdAfter: number;
  delta: number;
}

/** A ranked-leaderboard row (rating joined to the user's name). */
export interface RatingLeaderboardEntry {
  userId: string;
  username: string;
  mmr: number;
  rd: number;
  games: number;
  wins: number;
}

/** Active-sanction summary used at login / lobby-join (§10, §11). */
export interface ActiveSanctions {
  banned: boolean;
  banExpiresAt: number | null;
  muted: boolean;
  muteExpiresAt: number | null;
}

// --------------------------------------------------------------------------
// Social: profiles, presence, friends, chat rooms, direct messages
// (Social feature — HTTP-only, its own tables; never in the game hot path.)
// --------------------------------------------------------------------------

/** A user's public profile (free-text, length-capped server-side). */
export interface ProfileRow {
  userId: string;
  tagline: string | null;
  bio: string | null;
  /** Optional faction-flair key (validated against a client allowlist; ≤24). */
  accent: string | null;
  updatedAt: number;
}

/** A public chat room: the global shoutbox or a topical channel. */
export interface ChatRoomRow {
  id: string;
  slug: string;
  name: string;
  topic: string;
  /** 'shoutbox' (the global wire) | 'channel' (a topical room). */
  kind: string;
  sort: number;
  createdAt: number;
}

/** A single posted room message (joined to its author's username). */
export interface RoomMessageRow {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  body: string;
  createdAt: number;
}

/** A single direct message in a thread. */
export interface DmMessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: number;
}

/** Canonical friendship status between the caller and another user. */
export type FriendshipStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';

// --------------------------------------------------------------------------
// Forums: categories → boards → threads (topics) → posts (Forums feature —
// HTTP-only, its own tables; never in the game hot path).
// --------------------------------------------------------------------------

/** A forum board row (a topical board under a category). */
export interface ForumBoardRow {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string;
  sort: number;
  createdAt: number;
}

/** The latest post summary for a board (forum-index "Last post" column). */
export interface ForumLastPost {
  threadId: string;
  threadTitle: string;
  at: number;
  username: string;
}

/** One board with aggregate stats + its latest post, for the forum index. */
export interface ForumIndexBoard {
  slug: string;
  name: string;
  description: string;
  sort: number;
  threadCount: number;
  postCount: number;
  lastPost: ForumLastPost | null;
}

/** One category (header bar) plus its ordered boards, for the forum index. */
export interface ForumIndexCategory {
  category: { slug: string; name: string; sort: number };
  boards: ForumIndexBoard[];
}

/** A thread row as listed within a board (author + last-poster joined). */
export interface ForumThreadListRow {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  locked: boolean;
  pinned: boolean;
  views: number;
  postCount: number;
  createdAt: number;
  lastPostAt: number;
  lastPosterName: string | null;
}

/** A single thread read back for its thread page (board context joined). */
export interface ForumThreadView {
  id: string;
  boardId: string;
  boardSlug: string;
  boardName: string;
  title: string;
  authorId: string;
  authorName: string;
  locked: boolean;
  pinned: boolean;
  views: number;
  postCount: number;
  createdAt: number;
}

/** A single post within a thread (author + their join date joined). */
export interface ForumPostRow {
  id: string;
  authorId: string;
  authorName: string;
  authorJoined: number | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

export interface Store {
  readonly persistent: boolean;

  /**
   * Verify the store is reachable (Task D). PgStore runs `SELECT 1`; MemoryStore
   * resolves immediately. Called once at boot for persistent stores so the
   * server fails fast against a dead database instead of booting "healthy".
   */
  healthCheck(): Promise<void>;

  // Users / auth (§7.1) — absent in NO_DB (returns null / throws on register).
  createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<UserRow>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  /** Resolve a user by email (case-insensitive). Account-only; null in NO_DB.
   *  Used by the password-reset "identifier" lookup. */
  getUserByEmail(email: string): Promise<UserRow | null>;
  setLastLogin(id: string): Promise<void>;

  // Sessions (§7.1)
  createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>;
  getSessionUserId(tokenHash: string): Promise<string | null>;
  revokeSession(tokenHash: string): Promise<void>;
  /**
   * Read a session's user id AND its current expiry (epoch ms), or null if the
   * session is absent/revoked/expired. Used by sliding-refresh (Task C) so the
   * server can decide whether the session is past its half-life without a second
   * round-trip.
   */
  getSession(tokenHash: string): Promise<{ userId: string; expiresAt: number } | null>;
  /** Extend a live session's expiry to `expiresAt` (sliding refresh, Task C). */
  extendSession(tokenHash: string, expiresAt: number): Promise<void>;

  // Account lifecycle: password reset + email verification (retention wave).
  // Persistent-only flows; the in-memory NO_DB store implements these minimally
  // (no-op / null) since accounts do not exist there.
  /** Store a password-reset token hash for a user (~1h expiry). */
  createPasswordReset(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  /** Read a reset token's state, or null if the hash is unknown. */
  getPasswordReset(tokenHash: string): Promise<PasswordResetRow | null>;
  /** Mark a reset token consumed so it cannot be replayed. */
  markPasswordResetUsed(tokenHash: string): Promise<void>;
  /** Replace a user's password hash (after a validated reset). */
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  /** Revoke every session for a user (so a reset logs out other devices). */
  revokeAllSessions(userId: string): Promise<void>;
  /** Store an email-verification token hash for a user. */
  createEmailVerification(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  /** Consume a verification token (single-use): returns its user id, or null. */
  consumeEmailVerification(tokenHash: string): Promise<string | null>;
  /** Mark a user's email confirmed. */
  setEmailVerified(userId: string): Promise<void>;

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
  /** Read a persisted match back for replay/export (§9). Null if absent. */
  getMatchReplay(matchId: string): Promise<MatchReplay | null>;
  /** User ids that participated in a match (replay-access authorization, §9). */
  getMatchParticipants(matchId: string): Promise<string[]>;

  // Public, no-auth retention surfaces (home-page social proof + share cards).
  // CRITICAL leak-safety: both MUST expose ONLY finished matches (ended_at NOT
  // NULL). An in-progress game's roles/seats must never be returned here.
  /**
   * Recent FINISHED matches (newest first), each with a seat count. `limit` is
   * capped (≤30) by the caller; the store also clamps defensively. Empty under
   * a non-persistent store (NO_DB derives from in-memory matches, or []).
   */
  getRecentMatches(limit: number): Promise<RecentMatchSummary[]>;
  /**
   * Public summary for a FINISHED match (the shareable, no-auth replay card), or
   * null when the id is unknown OR the match is still in progress (ended_at
   * null). `name` resolves to the account username for seats whose
   * user_or_guest_id maps to a users row, else null (guests). Seats ordered.
   */
  getPublicMatchSummary(matchId: string): Promise<PublicMatchSummary | null>;

  // Points & achievements (goal: points system) — written at match end.
  /** Apply per-match stat increments and refresh last_match_at. */
  addToUserStats(userId: string, delta: StatsDelta, at: number): Promise<void>;
  /** Append point-award ledger rows. */
  recordPoints(userId: string, awards: PointAwardRecord[]): Promise<void>;
  /**
   * Insert achievement rows the user does not already hold; returns the keys
   * that were newly unlocked (so the server only awards their points once).
   */
  unlockAchievements(
    userId: string,
    items: { key: string; points: number }[],
  ): Promise<string[]>;
  getUserStats(userId: string): Promise<UserStatsRow | null>;
  getUserAchievements(userId: string): Promise<string[]>;
  getLeaderboard(limit: number): Promise<LeaderboardEntry[]>;

  // Custom setups (custom setup builder). The server validates the setup before
  // calling createCustomSetup; the store only persists/reads it.
  createCustomSetup(ownerUserId: string, name: string, setup: GameSetup): Promise<CustomSetupRow>;
  getCustomSetup(id: string): Promise<CustomSetupRow | null>;
  listCustomSetups(ownerUserId: string): Promise<CustomSetupRow[]>;
  /** Delete a setup; succeeds only if owned by `ownerUserId`. Returns whether a row was removed. */
  deleteCustomSetup(id: string, ownerUserId: string): Promise<boolean>;

  // Ranked play + role preferences (goal: ranked + preferences). Written at
  // match end alongside the match row; guests/TEST games are excluded upstream.
  /** The current season, or null if none has been opened. */
  getCurrentSeason(): Promise<SeasonRow | null>;
  /** Return the current season, creating one with `name` if none is current. */
  ensureCurrentSeason(name: string): Promise<SeasonRow>;
  /**
   * Season rollover (admin-triggered): atomically END the current season
   * (ended_at=now, is_current=false), OPEN a new current season named `newName`,
   * and SOFT-RESET every current rating into the new season (mmr pulled toward
   * the mean, rd re-inflated, vol/games/wins reset) so the old season's ratings
   * remain archived under their season id. Returns the NEW current season. A
   * no-op-safe error if there is no current season to roll over.
   */
  rolloverSeason(newName: string): Promise<SeasonRow>;
  /** Recent seasons, newest first (archive browser). `limit` clamped (≤100). */
  getSeasons(limit: number): Promise<SeasonRow[]>;
  /** A user's rating for a (mode, season), or null if they have not played it. */
  getRating(userId: string, mode: string, seasonId: string): Promise<RatingRow | null>;
  /** Insert-or-update a rating by its (user, mode, season) key; bumps updated_at. */
  upsertRating(row: RatingRow): Promise<void>;
  /** Top ratings for a (mode, season), highest mmr first (joined to usernames). */
  getRatingLeaderboard(
    mode: string,
    seasonId: string,
    limit: number,
  ): Promise<RatingLeaderboardEntry[]>;
  /**
   * One page of the ranked leaderboard for a (mode, season), highest mmr first
   * (joined to usernames). `offset`/`limit` are clamped by the store; pair with
   * {@link getRatingCount} for the total. Used by the paginated public endpoint.
   */
  getRatingLeaderboardPage(
    mode: string,
    seasonId: string,
    offset: number,
    limit: number,
  ): Promise<RatingLeaderboardEntry[]>;
  /** Total number of rated players for a (mode, season) (pagination total). */
  getRatingCount(mode: string, seasonId: string): Promise<number>;
  /**
   * A user's 1-based rank position in a (mode, season): the count of ratings with
   * strictly higher mmr, plus one. Null if the user has no rating in that season.
   */
  getRankPosition(userId: string, mode: string, seasonId: string): Promise<number | null>;
  /** A user's role preferences (likes + blacklists). */
  getRolePreferences(userId: string): Promise<RolePreference[]>;
  /** Set or clear (preference=null removes the row) a user's preference for a role. */
  setRolePreference(
    userId: string,
    role: string,
    preference: 'blacklist' | 'prefer' | null,
  ): Promise<void>;
  /** Bulk-append per-match rating deltas (ignores already-written (match,user) rows). */
  writeRankedResults(rows: RankedResultInput[]): Promise<void>;
  /** Recent ranked results for a user, newest first (match history). */
  getRankedResults(userId: string, limit: number): Promise<RankedResultInput[]>;

  // Telemetry rollup (§15)
  upsertDailyRollup(day: string, fields: Record<string, number>): Promise<void>;

  // --- Social: profiles & presence -----------------------------------------
  /** A user's public profile, or null if they have not set one. */
  getProfile(userId: string): Promise<ProfileRow | null>;
  /** Insert-or-update a user's profile (each field length-capped by the caller). */
  upsertProfile(
    userId: string,
    fields: { tagline?: string | undefined; bio?: string | undefined; accent?: string | undefined },
  ): Promise<void>;
  /** Record a presence ping (users.last_seen_at). `at` is epoch ms. */
  touchPresence(userId: string, at: number): Promise<void>;
  /** Last-seen epoch-ms (or null) for each of the given user ids. */
  getLastSeen(userIds: string[]): Promise<Record<string, number | null>>;

  // --- Social: friends ------------------------------------------------------
  /**
   * Request friendship. If a *reverse* pending row already exists, accept it
   * ('accepted'); a same-direction pending/accepted row returns 'exists';
   * otherwise a new pending row is created ('created').
   */
  requestFriend(
    requesterId: string,
    addresseeId: string,
  ): Promise<'created' | 'exists' | 'accepted'>;
  /** Respond to a request (only the addressee may act). accept→accepted; decline→delete. */
  respondFriend(userId: string, friendshipId: string, accept: boolean): Promise<boolean>;
  /** Remove the friendship (any row) for the unordered pair. */
  removeFriend(userId: string, otherId: string): Promise<boolean>;
  /** The caller's accepted friends (id, name, last-seen). */
  listFriends(
    userId: string,
  ): Promise<Array<{ userId: string; username: string; lastSeen: number | null }>>;
  /** Incoming + outgoing pending friend requests for the caller. */
  listFriendRequests(userId: string): Promise<{
    incoming: Array<{ id: string; userId: string; username: string; createdAt: number }>;
    outgoing: Array<{ id: string; userId: string; username: string; createdAt: number }>;
  }>;
  /** Friendship status between the caller and another user. */
  friendshipStatus(userId: string, otherId: string): Promise<FriendshipStatus>;

  // --- Social: chat rooms ---------------------------------------------------
  /** All chat rooms, ordered by sort. */
  listRooms(): Promise<ChatRoomRow[]>;
  /** A room by its slug, or null. */
  getRoomBySlug(slug: string): Promise<ChatRoomRow | null>;
  /** Post a message to a room (returns the persisted row, author joined). */
  postRoomMessage(roomId: string, userId: string, body: string): Promise<RoomMessageRow>;
  /**
   * The newest `limit` messages for a room, ascending by time. With `sinceId`,
   * only messages strictly newer than that id (poll deltas). `limit` capped ≤100.
   */
  listRoomMessages(
    roomId: string,
    opts: { limit: number; sinceId?: string },
  ): Promise<
    Array<{ id: string; userId: string; username: string; body: string; createdAt: number }>
  >;

  // --- Social: direct messages ---------------------------------------------
  /** The canonical thread id for an unordered pair (creating it if needed). */
  ensureDmThread(a: string, b: string): Promise<string>;
  /** Post a DM (bumps the thread's last_at). */
  postDm(threadId: string, senderId: string, body: string): Promise<DmMessageRow>;
  /** The caller's DM threads, newest first (with the other participant + preview). */
  listDmThreads(userId: string): Promise<
    Array<{
      threadId: string;
      otherUserId: string;
      otherUsername: string;
      lastAt: number;
      preview: string;
    }>
  >;
  /** Messages in a thread, ascending. With `sinceId`, only newer ones. `limit` ≤100. */
  listDmMessages(
    threadId: string,
    opts: { limit: number; sinceId?: string },
  ): Promise<Array<{ id: string; senderId: string; body: string; createdAt: number }>>;
  /** The two participant user ids of a thread (for authorization), or null. */
  dmThreadParticipants(threadId: string): Promise<[string, string] | null>;

  // --- Forums: categories, boards, threads, posts --------------------------
  /** The forum index: categories (ordered) with their boards + aggregate stats. */
  listForumIndex(): Promise<ForumIndexCategory[]>;
  /** A board by its slug, or null. */
  getBoardBySlug(slug: string): Promise<ForumBoardRow | null>;
  /** Threads in a board: pinned first, then last_post_at desc. `limit` ≤50. */
  listThreads(
    boardId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ threads: ForumThreadListRow[]; total: number }>;
  /** Create a thread + its opening post atomically (post_count=1, last_post_at=now). */
  createThread(
    boardId: string,
    authorId: string,
    title: string,
    body: string,
  ): Promise<{ threadId: string; postId: string }>;
  /** A single thread (board context joined), or null if absent. */
  getThread(threadId: string): Promise<ForumThreadView | null>;
  /** Bump a thread's view counter by one. */
  incrementThreadViews(threadId: string): Promise<void>;
  /** Posts in a thread, ascending by created_at. `limit` ≤50. */
  listPosts(
    threadId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ posts: ForumPostRow[]; total: number }>;
  /**
   * Append a post to a thread; null if the thread is missing or locked. Bumps the
   * thread's post_count + last_post_at/last_poster_id.
   */
  createPost(threadId: string, authorId: string, body: string): Promise<{ postId: string } | null>;
  /** Edit a post — only the author (or an admin) may; sets edited_at. */
  editPost(postId: string, editorId: string, isAdmin: boolean, body: string): Promise<boolean>;
  /** Admin moderation: set a thread's locked/pinned flags. */
  setThreadFlags(threadId: string, flags: { locked?: boolean; pinned?: boolean }): Promise<boolean>;

  close(): Promise<void>;
}
