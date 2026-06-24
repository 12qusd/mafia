-- Project NOCTURNE — Postgres schema (BUILD_SPEC §10).
--
-- In-flight game state lives in process memory; this schema is written at match
-- end plus moderation events (no DB calls in the per-message hot path, §2.2).
-- The migration runner (src/db/migrate.ts) applies this file idempotently.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- Identity & sessions (§7.1, §10)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      citext UNIQUE NOT NULL,
  email         citext NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NULL,
  -- bit flags: 1 = admin (§11.3). Future flags reserved.
  flags         int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- --------------------------------------------------------------------------
-- Matches & event log (§4.3, §10) — append-only, written at match end
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS matches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_id     text NOT NULL,
  config       jsonb NOT NULL,
  seed         text NOT NULL,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz NULL,
  outcome      text NULL,
  server_build text NOT NULL,
  -- Replay integrity fingerprint (§9): HMAC-SHA256 over the canonical match
  -- record (setup, seed, players, ordered event log). Verified on replay read.
  fingerprint  text NULL,
  -- Queue the match was played in: casual | ranked | quickplay. Ranked matches
  -- additionally carry the season they counted toward (see ratings below).
  mode         text NULL,
  season_id    uuid NULL
);
-- Idempotent column add for databases created before the fingerprint column.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS fingerprint text;
-- Idempotent column adds for ranked play (mode + season tag on existing rows).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS season_id uuid;

CREATE TABLE IF NOT EXISTS match_players (
  match_id        uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_or_guest_id text NOT NULL,
  seat            int NOT NULL,
  role            text NOT NULL,
  faction         text NOT NULL,
  outcome         text NOT NULL,   -- win | loss | draw | left
  survived        boolean NOT NULL,
  death_day       int NULL,        -- 1-based in-game day of death, null if survived
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players(user_or_guest_id);
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS death_day int;

CREATE TABLE IF NOT EXISTS match_events (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq      int  NOT NULL,
  phase    text NOT NULL,
  event    jsonb NOT NULL,
  PRIMARY KEY (match_id, seq)
);

-- --------------------------------------------------------------------------
-- Points, achievements & progression (goal: points system) — written at
-- match end alongside the match row; never in the per-message hot path.
-- Guests and TEST-mode games are excluded by the server before writing.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_stats (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_points      bigint NOT NULL DEFAULT 0,
  games_played      int NOT NULL DEFAULT 0,
  games_won         int NOT NULL DEFAULT 0,
  games_survived    int NOT NULL DEFAULT 0,
  -- Sum of in-game days spent dead-but-watching (loyalty signal, §4).
  days_dead_watched int NOT NULL DEFAULT 0,
  last_match_at     timestamptz NULL
);
CREATE INDEX IF NOT EXISTS user_stats_points_idx ON user_stats(total_points DESC);

CREATE TABLE IF NOT EXISTS achievements (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement    text NOT NULL,
  points_awarded int NOT NULL DEFAULT 0,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement)
);

-- Append-only ledger of every point award (audit + profile timeline).
CREATE TABLE IF NOT EXISTS point_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id   uuid NULL,
  reason     text NOT NULL,   -- played | win | survived_to_end | loyalty_dead | achievement
  detail     text NULL,       -- achievement key, etc.
  points     int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_log_user_idx ON point_log(user_id);

-- --------------------------------------------------------------------------
-- Ranked play + role-preference unlocks (goal: ranked + preferences) — Glicko-2
-- ratings, seasons, per-match rating deltas, and per-user role likes/blacklists.
-- Written at match end alongside the match row; never in the per-message hot path.
-- Guests and TEST-mode games are excluded by the server before writing.
-- --------------------------------------------------------------------------

-- Ranked seasons. At most one is the current season at a time (partial unique
-- index below); a season ends when ended_at is set and is_current flips false.
CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz NULL,
  is_current boolean NOT NULL DEFAULT false
);
-- Enforce a single current season (partial unique index on the live flag).
CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_current_idx
  ON seasons (is_current) WHERE is_current;

-- Per-user, per-mode, per-season rating. Glicko-2 state: mmr (rating r), rd
-- (rating deviation), vol (volatility). games/wins track the season record.
CREATE TABLE IF NOT EXISTS ratings (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       text NOT NULL,
  season_id  uuid NOT NULL,
  mmr        double precision NOT NULL DEFAULT 1500,
  rd         double precision NOT NULL DEFAULT 350,
  vol        double precision NOT NULL DEFAULT 0.06,
  games      int NOT NULL DEFAULT 0,
  wins       int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode, season_id)
);
-- Ranked leaderboard read: top mmr per (mode, season).
CREATE INDEX IF NOT EXISTS ratings_leaderboard_idx
  ON ratings (mode, season_id, mmr DESC);

-- Per-user role preferences for matchmaking/assignment: 'prefer' (more likely)
-- or 'blacklist' (avoid). One row per (user, role).
CREATE TABLE IF NOT EXISTS role_preferences (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL,
  preference text NOT NULL,   -- 'blacklist' | 'prefer'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Append-only per-match rating deltas (audit trail + profile match history).
-- match_id/user_id are stored loosely (no FK) so a ranked result survives even
-- if the match row write is skipped/pruned; the server writes both together.
CREATE TABLE IF NOT EXISTS ranked_results (
  match_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  mode       text NOT NULL,
  mmr_before double precision NOT NULL,
  mmr_after  double precision NOT NULL,
  rd_before  double precision NOT NULL,
  rd_after   double precision NOT NULL,
  delta      double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
-- Recent ranked match history for a user.
CREATE INDEX IF NOT EXISTS ranked_results_user_idx
  ON ranked_results (user_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Custom & scheduled setups (custom setup builder + setup-of-the-day)
-- --------------------------------------------------------------------------

-- User-built role setups, validated server-side before insert. The full
-- GameSetup is stored as JSONB; lobbies reference it by the `custom:<uuid>` id.
CREATE TABLE IF NOT EXISTS custom_setups (
  id            text PRIMARY KEY,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  json          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_setups_owner_idx ON custom_setups(owner_user_id);

-- Optional persistence for an admin-overridable setup-of-the-day. The daily
-- feature is otherwise computed purely from the date; a row here pins a day.
CREATE TABLE IF NOT EXISTS scheduled_setups (
  day        date PRIMARY KEY,
  setup_id   text NOT NULL,
  kind       text NOT NULL,   -- shipped | custom | chaos
  chaos_seed text NULL
);

-- --------------------------------------------------------------------------
-- Chat (§10) — partitioned weekly; retention via DROP PARTITION (90d)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_messages (
  match_id    uuid NOT NULL,
  seq         int NOT NULL,
  channel     text NOT NULL,
  sender_seat int NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- A catch-all default partition so inserts never fail before the weekly
-- maintenance job creates dated partitions. Weekly partitions + DROP PARTITION
-- retention (90d) are an operational job, documented in DECISIONS-server.md.
CREATE TABLE IF NOT EXISTS chat_messages_default
  PARTITION OF chat_messages DEFAULT;

-- --------------------------------------------------------------------------
-- Moderation (§11, §10)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter    text NOT NULL,
  target_user text NOT NULL,
  match_id    uuid NULL,
  category    text NOT NULL,
  comment     text NULL,
  evidence    jsonb NULL,   -- chat excerpt auto-attached server-side at report time
  created_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'open',
  reviewed_by text NULL,
  -- dedupe per (target, match) (§11.1)
  UNIQUE (target_user, match_id, reporter)
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);

CREATE TABLE IF NOT EXISTS sanctions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  type       text NOT NULL,   -- warning | mute | temp_ban | perma_ban
  reason     text NULL,
  report_id  uuid NULL REFERENCES reports(id) ON DELETE SET NULL,
  issued_by  text NOT NULL,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS sanctions_user_idx ON sanctions(user_id);

-- Per-account client mutes that are server-enforced (§11.2).
CREATE TABLE IF NOT EXISTS mutes (
  muter_id text NOT NULL,
  muted_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id)
);

-- Admin action audit log (§11.3 — every admin action logged).
CREATE TABLE IF NOT EXISTS admin_audit (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id  text NOT NULL,
  action    text NOT NULL,
  detail    jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Telemetry daily rollups (§15)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS telemetry_daily (
  day              date PRIMARY KEY,
  lobbies_created  int NOT NULL DEFAULT 0,
  matches_started  int NOT NULL DEFAULT 0,
  matches_completed int NOT NULL DEFAULT 0,
  disconnects      int NOT NULL DEFAULT 0,
  resumes          int NOT NULL DEFAULT 0,
  reports          int NOT NULL DEFAULT 0,
  dau              int NOT NULL DEFAULT 0,
  peak_concurrent  int NOT NULL DEFAULT 0,
  avg_lobby_wait_ms double precision NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- Social: profiles, presence, friends, public chat rooms, direct messages
-- (Social feature) — additive + idempotent; HTTP-only, never in the game hot
-- path. Guests are read-only; account-only writes are enforced server-side.
-- --------------------------------------------------------------------------

-- Public profile (tagline/bio/accent flair). One row per user.
CREATE TABLE IF NOT EXISTS profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tagline    text NULL,
  bio        text NULL,
  -- Optional faction-flair key (free text; client validates an allowlist, the
  -- server only length-caps it ≤24).
  accent     text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Presence: last activity ping (profile/online dots). Idempotent column add.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL;

-- Friendships. One row per unordered pair (enforced by the pair index below).
-- status: 'pending' (requester→addressee) | 'accepted'.
CREATE TABLE IF NOT EXISTS friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',   -- pending | accepted
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz NULL,
  CHECK (requester_id <> addressee_id)
);
-- Exactly one row per unordered pair (direction-agnostic).
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_idx
  ON friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);

-- Public chat rooms: the global shoutbox + topical channels.
CREATE TABLE IF NOT EXISTS chat_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  name       text NOT NULL,
  topic      text NOT NULL DEFAULT '',
  kind       text NOT NULL DEFAULT 'channel',   -- shoutbox | channel
  sort       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Seed the default rooms (idempotent on slug).
INSERT INTO chat_rooms (slug, name, topic, kind, sort) VALUES
  ('shoutbox', 'The Wire', 'Word on the street — keep it short.', 'shoutbox', 0),
  ('parlor',   'The Parlor', 'General chatter for made men and marks alike.', 'channel', 1),
  ('strategy', 'The Back Room', 'Strategy, role talk, post-game tells.', 'channel', 2),
  ('offtopic', 'The Speakeasy', 'Anything goes after hours.', 'channel', 3)
ON CONFLICT (slug) DO NOTHING;

-- Room messages (the shoutbox + channels). Newest-first reads via the index.
CREATE TABLE IF NOT EXISTS room_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_messages_room_idx ON room_messages (room_id, created_at DESC);

-- Direct-message threads. Canonical ordering: user_lo < user_hi (lexicographic
-- on the uuid text), one row per pair.
CREATE TABLE IF NOT EXISTS dm_threads (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_lo uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_hi uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_lo < user_hi),
  UNIQUE (user_lo, user_hi)
);

-- Direct messages within a thread.
CREATE TABLE IF NOT EXISTS dm_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dm_messages_thread_idx ON dm_messages (thread_id, created_at);

-- --------------------------------------------------------------------------
-- Social completeness (social v1): DM unread tracking + soft-delete tombstones.
-- Additive + idempotent; HTTP-only, never in the game hot path. Blocking reuses
-- the existing `mutes` table (muter→muted) — no new table needed for blocks.
-- --------------------------------------------------------------------------

-- Per-(user, thread) read cursor for DM unread badges. last_read_at is bumped
-- to now() whenever the user opens (fetches) a thread; unread = count of newer
-- messages from the OTHER participant that are not soft-deleted.
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

-- Soft-delete tombstones. Deleted rows are KEPT (thread/forum continuity) but
-- reads surface `deleted` and null the body so the client renders "[removed]".
ALTER TABLE dm_messages   ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- Forums: a phpBB-style message board — categories → boards → threads
-- (topics) → posts (Forums feature). Additive + idempotent; HTTP-only, never
-- in the game hot path. Guests are read-only; account-only writes are enforced
-- server-side; muted/banned users cannot post.
-- --------------------------------------------------------------------------

-- Top-level categories (the header bars on the index). Ordered by sort.
CREATE TABLE IF NOT EXISTS forum_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  name       text NOT NULL,
  sort       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Boards within a category. Ordered by sort within their category.
CREATE TABLE IF NOT EXISTS forum_boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort        int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_boards_category_idx ON forum_boards (category_id, sort);

-- Threads (topics) within a board. last_post_at + last_poster_id track the most
-- recent reply so board/index reads avoid scanning posts.
CREATE TABLE IF NOT EXISTS forum_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      uuid NOT NULL REFERENCES forum_boards(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  locked        boolean NOT NULL DEFAULT false,
  pinned        boolean NOT NULL DEFAULT false,
  views         int NOT NULL DEFAULT 0,
  post_count    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_post_at  timestamptz NOT NULL DEFAULT now(),
  last_poster_id uuid NULL
);
-- Board listing: pinned first, then newest activity.
CREATE INDEX IF NOT EXISTS forum_threads_board_idx
  ON forum_threads (board_id, pinned DESC, last_post_at DESC);

-- Posts within a thread, ascending by created_at on read.
CREATE TABLE IF NOT EXISTS forum_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz NULL
);
CREATE INDEX IF NOT EXISTS forum_posts_thread_idx ON forum_posts (thread_id, created_at);

-- Seed the default categories (idempotent on slug).
INSERT INTO forum_categories (slug, name, sort) VALUES
  ('the-family',  'The Family',  0),
  ('the-game',    'The Game',    1),
  ('after-hours', 'After Hours', 2)
ON CONFLICT (slug) DO NOTHING;

-- Seed the default boards under their categories (idempotent on slug).
INSERT INTO forum_boards (category_id, slug, name, description, sort)
SELECT c.id, b.slug, b.name, b.description, b.sort
FROM (VALUES
  ('the-family',  'announcements', 'Announcements',     'Word from the bosses.',              0),
  ('the-family',  'introductions', 'New in Town',        'Introduce yourself to the family.',  1),
  ('the-game',    'strategy',      'Strategy & Roles',   'Tactics, role talk, setups.',        0),
  ('the-game',    'results',       'Results & Replays',  'Post your games and tells.',         1),
  ('after-hours', 'offtopic',      'The Speakeasy',      'Anything goes after dark.',          0)
) AS b(category_slug, slug, name, description, sort)
JOIN forum_categories c ON c.slug = b.category_slug
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- Account lifecycle: password reset + email verification (retention wave).
-- Additive + idempotent; account-only (the in-memory NO_DB store no-ops these).
-- --------------------------------------------------------------------------

-- Whether the user's email has been confirmed (welcome/verify flow).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- Referral / invite tracking: the account (if any) that referred this user, set
-- at register time when a valid, different referrer id/username is supplied.
-- ON DELETE SET NULL so removing a referrer never cascades away their referees.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;
-- Fast "how many people did I refer" count (getReferralCount).
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by);

-- One-time password-reset tokens (only the token HASH is stored; ~1h validity).
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);

-- One-time email-verification tokens (token HASH only; consumed on verify).
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id);

-- --------------------------------------------------------------------------
-- Notifications center (QoL wave) — HTTP-only, its own table; never touched in
-- the game hot path or the §5 leak path. Unifies friend-requests, accepts,
-- @mentions (future), rank-ups, and achievements into one account-only feed.
-- type: friend_request | friend_accepted | mention | rank_up | achievement.
-- payload is small JSON (ids + names + numbers; the client sanitizes names).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz NULL
);
-- Feed read (newest first) per user.
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
-- Fast unread count (partial index over only the unread rows).
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
