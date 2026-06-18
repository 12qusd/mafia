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
  fingerprint  text NULL
);
-- Idempotent column add for databases created before the fingerprint column.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS fingerprint text;

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
