import type { Phase } from './types/phase.js';

/**
 * Project-wide constants and tunables (BUILD_SPEC §6.2, §6.4, §11.5, §9).
 *
 * This module is data-only and imports no other shared module except plain
 * types, so it can be imported anywhere (notably by `types/lobby.ts`) without
 * cycles.
 */

/**
 * Working game name (BUILD_SPEC §2 codename note, §3). The single point of
 * change for the shipping title; never hardcode the codename anywhere else.
 */
export const GAME_NAME = 'Nocturne' as const;

/** Network protocol version carried in every message envelope (`{v}`, §9). */
export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Phase timings (BUILD_SPEC §6.2). Seconds.
// ---------------------------------------------------------------------------

/** Default duration per phase (seconds). Fixed phases included for reference. */
export const DEFAULT_PHASE_SECONDS = {
  DAY_0: 45,
  NIGHT: 60,
  DAY_DISCUSSION: 45,
  DAY_VOTING: 150,
  TRIAL_DEFENSE: 25,
  TRIAL_JUDGMENT: 25,
} as const;

/**
 * Configurable [min,max] bounds per phase (seconds). The host may only set
 * durations within these inclusive bounds.
 */
export const PHASE_TIMING_BOUNDS = {
  DAY_0: { min: 15, max: 120 },
  NIGHT: { min: 30, max: 120 },
  DAY_DISCUSSION: { min: 0, max: 180 },
  DAY_VOTING: { min: 60, max: 360 },
  TRIAL_DEFENSE: { min: 15, max: 60 },
  TRIAL_JUDGMENT: { min: 15, max: 60 },
} as const;

/** DAWN pacing (fixed, §6.2): base + per-death increment (seconds). */
export const DAWN_BASE_SECONDS = 8 as const;
export const DAWN_PER_DEATH_SECONDS = 4 as const;

/** EXECUTION duration: last words + reveal (fixed, §6.2). Seconds. */
export const EXECUTION_SECONDS = 12 as const;

// ---------------------------------------------------------------------------
// Trials & day flow (BUILD_SPEC §6.3).
// ---------------------------------------------------------------------------

/** Maximum trials per day; after the third innocent verdict the day ends (§6.3). */
export const MAX_TRIALS_PER_DAY = 3 as const;

/** A revealed Mayor's vote weight (§6.3). Default seat vote weight is 1. */
export const DEFAULT_VOTE_WEIGHT = 1 as const;
export const MAYOR_VOTE_WEIGHT = 3 as const;

// ---------------------------------------------------------------------------
// Per-role ability uses (BUILD_SPEC §6.5).
// ---------------------------------------------------------------------------

export const VIGILANTE_BULLETS = 2 as const;
export const JAILOR_EXECUTIONS = 2 as const;
export const SURVIVOR_VESTS = 4 as const;
export const DOCTOR_SELF_HEALS = 1 as const;

// --- Role-expansion batch A metered uses ---
/** Janitor cleanings available across the match (§ batch A). */
export const JANITOR_CLEANS = 3 as const;
/** Veteran alerts available across the match (§ batch A). */
export const VETERAN_ALERTS = 3 as const;

// ---------------------------------------------------------------------------
// Rate limits (BUILD_SPEC §6.4, §11.5).
// ---------------------------------------------------------------------------

/** Per-channel chat rate limit: max messages per window (§6.4). */
export const CHAT_RATE_MAX_MESSAGES = 5 as const;
export const CHAT_RATE_WINDOW_MS = 10_000 as const;

/** Whisper rate limit: minimum gap between whispers (§6.4). */
export const WHISPER_MIN_INTERVAL_MS = 3_000 as const;

/** Connection-level rate limit (§11.5): max messages per window per socket. */
export const SOCKET_RATE_MAX_MESSAGES = 20 as const;
export const SOCKET_RATE_WINDOW_MS = 10_000 as const;

// ---------------------------------------------------------------------------
// Text caps (BUILD_SPEC §6.4, §11.6). Characters.
// ---------------------------------------------------------------------------

/**
 * Chat message cap. §6.4 fixes whispers/wills/notes but leaves the general
 * chat cap to the implementer; 256 chars matches the whisper/death-note cap and
 * keeps a single mental model (DECISIONS.md).
 */
export const CHAT_TEXT_MAX = 256 as const;
export const WHISPER_TEXT_MAX = 256 as const;
export const LAST_WILL_MAX = 500 as const;
export const DEATH_NOTE_MAX = 256 as const;
/** Display name cap (spec-silent; chosen for UI fit, DECISIONS.md). */
export const DISPLAY_NAME_MAX = 24 as const;
/** Report free-text comment cap (spec-silent; DECISIONS.md). */
export const REPORT_COMMENT_MAX = 1000 as const;

// ---------------------------------------------------------------------------
// Lobby / session limits.
// ---------------------------------------------------------------------------

/** Player-count range a match supports (BUILD_SPEC §1.1, §7.4). */
export const MIN_PLAYERS = 7 as const;
export const MAX_PLAYERS = 15 as const;

/** Spectator cap per room (BUILD_SPEC §7.8). */
export const SPECTATOR_CAP = 20 as const;

/** Private-lobby invite code length (BUILD_SPEC §7.2). */
export const INVITE_CODE_LENGTH = 6 as const;

/** Per-channel reconnect chat backlog cap (BUILD_SPEC §8). */
export const CHAT_BACKLOG_PER_CHANNEL = 200 as const;

// ---------------------------------------------------------------------------
// Engine / timing guards.
// ---------------------------------------------------------------------------

/** Network grace after a phase deadline before phase-end is appended (§6.2). Ms. */
export const NETWORK_GRACE_MS = 250 as const;

/** Stalemate guard: N consecutive zero-death nights ends the game (§6.9). */
export const STALEMATE_QUIET_NIGHTS = 3 as const;

/** AFK threshold: no command for N consecutive phases ⇒ flagged AFK (§8). */
export const AFK_PHASE_THRESHOLD = 2 as const;

/** Safety cap on match length for property tests / runaway guard (§12.1). */
export const MAX_DAY_NIGHT_CYCLES = 50 as const;

/** Phases whose durations the host may configure. */
export const CONFIGURABLE_PHASES = [
  'DAY_0',
  'NIGHT',
  'DAY_DISCUSSION',
  'DAY_VOTING',
  'TRIAL_DEFENSE',
  'TRIAL_JUDGMENT',
] as const satisfies readonly Phase[];
