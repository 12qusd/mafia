/**
 * Engine state model (BUILD_SPEC §6).
 *
 * {@link GameState} is plain, JSON-serializable data — no classes holding
 * closures, no functions, no Maps/Sets — so it can be hashed, diffed, persisted,
 * and replayed (§2.2, §4.3). The engine treats it immutably: `apply` returns a
 * new state rather than mutating the input.
 */

import type {
  SeatId,
  Phase,
  RoleId,
  Faction,
  GameTick,
  DeathCause,
  WinningParty,
  SeatOutcome,
  VerdictValue,
  InvestigatorClass,
  SheriffResult,
  ResolvedLobbyConfig,
} from '@nocturne/shared';
import type { PrngState } from './prng.js';

// ---------------------------------------------------------------------------
// Per-seat state
// ---------------------------------------------------------------------------

/** A seat's mutable game state. */
export interface SeatState {
  seat: SeatId;
  name: string;
  /** The role currently held. Mutates on succession (Mafioso) / conversion (Jester). */
  role: RoleId;
  faction: Faction;
  alive: boolean;
  /** Connection / AFK flags (server-fed via seat_* events). Public. */
  connected: boolean;
  afk: boolean;

  /** Whether this seat has been legally revealed (death reveal or game over). */
  revealed: boolean;

  /** Editable last will (≤500 chars), revealed on death. */
  lastWill: string;
  /** Editable death note (≤256 chars), for killers (Mafia performer, SK). */
  deathNote: string;

  // --- Limited-use ability counters (remaining uses) -----------------------
  /** Remaining metered uses (vigilante bullets, jailor executions, survivor vests). */
  usesRemaining: number;
  /** Remaining self-target uses (doctor self-heal). */
  selfUsesRemaining: number;

  // --- Per-role persistent flags -------------------------------------------
  /** Mayor has revealed (vote weight → 3, unhealable). */
  mayorRevealed: boolean;
  /**
   * Blackmailer (batch A): the nightNumber during which this seat was blackmailed.
   * While `silencedForNight === state.nightNumber` (the day phases immediately
   * following that night), the seat's day-chat messages are dropped. -1 = never.
   */
  silencedForNight: number;
  /** Executioner's assigned target seat (or null once converted / N/A). */
  exeTarget: SeatId | null;
  /**
   * Disguiser (batch B): the role appearance this seat currently shows to
   * investigations and its own death reveal. `null` = show the true role. The
   * overlay does NOT change the true `role`/`faction`/win; it is sticky until the
   * Disguiser re-disguises or dies.
   */
  apparentRole: RoleId | null;
  /**
   * Arsonist (batch B): whether this seat has been doused. A doused seat dies
   * (piercing basic defense) when ANY living Arsonist ignites. Persists until an
   * ignite burns it or the dousing Arsonist dies.
   */
  doused: boolean;
  /** Whether this seat has explicitly left the game (queued suicide). */
  leaving: boolean;

  /**
   * Admin turned this seat into a non-voting, town-aligned "stump" (goal 8).
   * Stumped seats keep `alive=true` but cannot vote, act at night, or use day
   * abilities; their faction is forced to TOWN for win conditions.
   */
  stumped: boolean;

  /** Why the seat died (set when alive→dead), for the trace and reveal. */
  deathCause: DeathCause | null;
  /** Day number the seat died (0 = alive). */
  deathDay: number | null;
}

// ---------------------------------------------------------------------------
// Night intents (submitted actions, pending resolution)
// ---------------------------------------------------------------------------

/** A submitted night ability for a seat (last submission wins). */
export interface NightIntent {
  seat: SeatId;
  /** The ability key (role.nightAction kind family) chosen. */
  ability: NightAbility;
  /** Target seat, or null for self/none. */
  target: SeatId | null;
}

/**
 * Night ability kinds the engine resolves. These mirror the shared
 * `NightActionKind` plus the concrete mafia-kill carrier.
 */
export type NightAbility =
  | 'investigate_sheriff'
  | 'investigate_investigator'
  | 'investigate_consigliere'
  | 'watch'
  | 'protect'
  | 'vest'
  | 'roleblock'
  | 'forge'
  | 'clean'
  | 'guard'
  | 'blackmail'
  | 'alert'
  // --- Role-expansion batch B ---
  | 'investigate_track' // Tracker: learn who the target visited
  | 'spy' // Spy: learn the seats the mafia visited (self, no target)
  | 'remember' // Amnesiac: remember a dead seat's role and become it
  | 'disguise' // Disguiser: take a dead seat's role appearance
  | 'douse' // Arsonist: mark a target as doused (no kill)
  | 'ignite' // Arsonist: kill all doused seats (self, no target)
  | 'kill_vigilante'
  | 'kill_mafia'
  | 'kill_serial'
  | 'kill_jailor'
  | 'frame'
  | 'mafia_control';

// ---------------------------------------------------------------------------
// Voting / trial state
// ---------------------------------------------------------------------------

/** Open nomination votes: voter seat → target ('skip' or seat). */
export interface NominationState {
  /** Sorted by seat for determinism. Each entry: voter → target. */
  votes: { seat: SeatId; target: SeatId | 'skip' }[];
  /** Trials already concluded this day (max 3). */
  trialsUsed: number;
  /** Remaining DAY_VOTING ticks when a trial paused the timer (null otherwise). */
  pausedRemainingMs: number | null;
}

/** A trial in progress. */
export interface TrialState {
  accused: SeatId;
  /** Judgment votes: voter → value. */
  verdicts: { seat: SeatId; value: VerdictValue }[];
}

// ---------------------------------------------------------------------------
// Resolution trace (the audit trail / golden-test fixture, §6.8)
// ---------------------------------------------------------------------------

/**
 * Structured night-resolution trace records. One discriminated union value per
 * meaningful step outcome. Persisted in state and surfaced in game_over.
 */
export type ResolutionTrace =
  | { step: 'jail'; jailor: SeatId; prisoner: SeatId }
  | { step: 'roleblock'; blocker: SeatId; target: SeatId; outcome: 'blocked' | 'immune' | 'cancelled_self_blocked' }
  | { step: 'sk_redirect'; sk: SeatId; blocker: SeatId; originalTarget: SeatId | null }
  | { step: 'protect'; doctor: SeatId; target: SeatId; kind: 'doctor' | 'vest' | 'jail' }
  | { step: 'frame'; framer: SeatId; target: SeatId }
  | { step: 'forge'; forger: SeatId; target: SeatId; applied: boolean }
  | { step: 'clean'; janitor: SeatId; target: SeatId; applied: boolean }
  | { step: 'guard'; bodyguard: SeatId; ward: SeatId; attacker: SeatId; killedAttacker: boolean }
  | { step: 'blackmail'; blackmailer: SeatId; target: SeatId }
  | { step: 'alert'; veteran: SeatId; visitors: SeatId[] }
  | { step: 'disguise'; disguiser: SeatId; target: SeatId; apparentRole: RoleId }
  | { step: 'douse'; arsonist: SeatId; target: SeatId }
  | { step: 'ignite'; arsonist: SeatId; victims: SeatId[] }
  | {
      step: 'kill';
      source: DeathCause;
      attacker: SeatId | null;
      target: SeatId;
      outcome: 'died' | 'unreachable' | 'immune' | 'healed' | 'failed';
    }
  | { step: 'investigate'; kind: 'sheriff'; investigator: SeatId; target: SeatId; result: SheriffResult }
  | { step: 'investigate'; kind: 'investigator'; investigator: SeatId; target: SeatId; result: InvestigatorClass }
  | { step: 'investigate'; kind: 'consigliere'; investigator: SeatId; target: SeatId; result: RoleId }
  | { step: 'investigate'; kind: 'lookout'; investigator: SeatId; target: SeatId; visitors: SeatId[] }
  | { step: 'investigate'; kind: 'tracker'; investigator: SeatId; target: SeatId; visited: SeatId[] }
  | { step: 'investigate'; kind: 'spy'; investigator: SeatId; seats: SeatId[] }
  | { step: 'death'; seat: SeatId; role: RoleId; cause: DeathCause }
  | { step: 'promotion'; kind: 'mafia_succession'; seat: SeatId; newRole: RoleId }
  | { step: 'promotion'; kind: 'executioner_to_jester'; seat: SeatId }
  | { step: 'promotion'; kind: 'amnesiac_remember'; seat: SeatId; newRole: RoleId }
  | { step: 'win'; reason: WinCheckReason; winners: WinningParty[] };

/** Why a win check fired (for the trace). */
export type WinCheckReason =
  | 'town_elimination'
  | 'mafia_parity'
  | 'serial_killer_last'
  | 'one_v_one'
  | 'stalemate'
  | 'all_dead';

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/** Final per-seat outcome at game over. */
export interface SeatResult {
  seat: SeatId;
  role: RoleId;
  faction: Faction;
  outcome: SeatOutcome;
}

/** Game-over summary. */
export interface GameOverState {
  winners: WinningParty[];
  results: SeatResult[];
  reason: WinCheckReason;
}

/**
 * The complete, serializable match state.
 */
export interface GameState {
  /** Schema version, for replay forward-compat. */
  version: 1;
  setupId: string;
  seed: string;
  matchId: string;
  config: ResolvedLobbyConfig;

  /** Current PRNG state (advances as randomness is consumed). */
  prng: PrngState;

  phase: Phase;
  /**
   * Day number. DAY_0 is day 0; the first NIGHT is night 1 (dayNumber stays 0
   * during the first night-cycle's NIGHT/DAWN, then increments to 1 at the first
   * DAY_DISCUSSION). We track nightNumber separately for "no shot on N1" rules.
   */
  dayNumber: number;
  /** Nights elapsed (NIGHT phases entered). Used for Vigilante N1 guard etc. */
  nightNumber: number;

  /** Server epoch ms the current phase ends; null if no deadline. */
  phaseEndsAt: GameTick | null;
  /** Timestamp of the last processed event (logical clock anchor). */
  lastTick: GameTick;

  seats: SeatState[];

  /** Mafia roster (seat ids), maintained as members die — for entitlement & roster. */
  mafiaSeats: SeatId[];

  /** Submitted night intents (cleared each night). Sorted by seat. */
  nightIntents: NightIntent[];
  /** Jailor's day-selected prisoner for the coming night (null = none). */
  jailTarget: SeatId | null;
  /**
   * Medium (batch B): the Medium seat that has opened a séance for the COMING
   * night (selected during the day, like the Jailor's prisoner). While set, that
   * living Medium is granted the DEAD chat entitlement for the next NIGHT. Cleared
   * at night resolution (the séance is one night). null = no séance pending.
   */
  seanceMedium: SeatId | null;

  nomination: NominationState;
  trial: TrialState | null;

  /** Seats scheduled to die at the next night resolution (jester grief). */
  pendingJesterGrief: { guiltyVoters: SeatId[] } | null;

  /** Consecutive zero-death nights (stalemate guard). */
  quietNights: number;

  /** Personal win flags accrued during play (riders awarded at game over). */
  jesterWinners: SeatId[];
  exeWinners: SeatId[];

  /** Accumulated resolution traces (full match audit trail). */
  traces: ResolutionTrace[];

  /** Set once the game ends. */
  gameOver: GameOverState | null;
}
