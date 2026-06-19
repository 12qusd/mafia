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
   * Guardian Angel (batch D): the assigned charge this GA must keep alive. Set at
   * init (a non-evil, non-self seat). Stays fixed; if the charge dies the GA is
   * converted to a Survivor and this is cleared (null). null = not a GA / spent.
   */
  gaTarget: SeatId | null;
  /**
   * Juggernaut (batch D): the number of kills this seat has landed. Drives the
   * escalation — after the first kill the Juggernaut may strike on any night, and
   * once it reaches the power threshold its attacks pierce basic defense and maul
   * visitors. 0 for every non-Juggernaut seat.
   */
  killCount: number;
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
  /**
   * Plaguebearer (batch E): whether this seat carries the plague. Spreads via
   * visits (the Plaguebearer's visits, and visitors to the Plaguebearer, and on
   * outward each night). When ALL living seats are infected the Plaguebearer
   * transforms into Pestilence. False for every seat at init.
   */
  infected: boolean;
  /**
   * Pirate (batch E): the number of successful plunders this seat has landed.
   * Drives the personal win (reach the threshold AND be alive at the end). 0 for
   * every non-Pirate seat.
   */
  plunderCount: number;
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
  /**
   * Coroner (batch F): the sorted seats that VISITED this seat the night it died
   * (set once, at the resolution that killed it, from that night's visit graph).
   * The Coroner's autopsy reads this back. Empty for a living seat, or for a death
   * with no recorded visitors (e.g. a day lynch — no night visit graph). Frozen at
   * death so a later night's traffic does not rewrite it.
   */
  deathVisitors: SeatId[];
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
  /**
   * Optional SECOND target. Used by the two-target abilities:
   *  - `witch_control` (batch E): the PUPPET in `target`, the VICTIM in `target2`.
   *  - `transport` (batch F): the FIRST seat to swap in `target`, the SECOND in
   *    `target2`. The Transporter swaps the two — everything aimed at one is
   *    redirected onto the other.
   * Every other ability ignores it. Undefined = no second target.
   */
  target2?: SeatId | null;
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
  // --- Role-expansion batch C ---
  | 'crusade' // Crusader: shield a ward + strike its lowest-seat visitor
  | 'ambush' // Ambusher: stake out a house + strike its lowest-seat visitor
  | 'divine' // Psychic: receive a vision (self, no target)
  | 'hypnotize' // Hypnotist: plant a false night feedback in a target
  // --- Role-expansion batch D (iconic neutrals) ---
  | 'rampage' // Werewolf: on a full-moon night, maul a target + everyone who visited the Werewolf
  | 'massacre' // Mass Murderer: kill a chosen house's resident + all other visitors there
  | 'shield' // Guardian Angel: ward the assigned charge from one attack
  | 'juggernaut' // Juggernaut: escalating lone-killer attack (visitor rampage once powerful)
  // --- Role-expansion batch E (complex neutrals / conversions) ---
  | 'witch_control' // Witch: seize a puppet (target) + steer their action onto a victim (target2)
  | 'duel' // Pirate: duel/plunder a target (occupies + shields them; PRNG-decided success)
  | 'infect' // Plaguebearer: a visit that infects the target (and spreads)
  | 'pestilence' // Pestilence: the transformed Plaguebearer's powerful kill
  | 'retribute' // Retributionist: once-per-game revive a dead Town seat
  // --- Vampire conversion faction (third evil killing faction) ---
  | 'bite' // Vampire: a visiting conversion attempt (turns the target into a Vampire)
  | 'vampire_check' // Vampire Hunter: study a target, learn vampire/not; passively stakes a biting vampire
  // --- Cult conversion faction (fourth evil faction) ---
  | 'recruit' // Cult Leader: a visiting conversion attempt (draws the target into the Cult)
  // --- Role-expansion batch F (distinct-mechanic Town roles) ---
  | 'transport' // Transporter: swap two seats (target + target2) — everything aimed at one is redirected onto the other
  | 'autopsy' // Coroner: read a DEAD seat's role + the seats that visited it the night it died
  | 'trap' // Trapper: arm a trap at a ward — shield one basic attack + name a caught visitor's seat (does not kill)
  | 'kill_vigilante'
  | 'kill_mafia'
  | 'kill_serial'
  | 'kill_jailor'
  | 'frame'
  | 'mafia_control'
  // --- Triad faction (second evil killing faction; mirror of mafia) ---
  | 'kill_triad' // Enforcer: performs the Triad kill (mirror of kill_mafia)
  | 'triad_control'; // Dragon Head: orders the Triad kill (mirror of mafia_control)

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
  // --- Role-expansion batch C ---
  | { step: 'crusade'; crusader: SeatId; ward: SeatId; struck: SeatId | null }
  | { step: 'ambush'; ambusher: SeatId; target: SeatId; struck: SeatId | null }
  | { step: 'divine'; psychic: SeatId; parity: 'evil' | 'good'; seats: SeatId[] }
  | { step: 'hypnotize'; hypnotist: SeatId; target: SeatId; fake: string }
  // --- Role-expansion batch D ---
  | { step: 'rampage'; werewolf: SeatId; target: SeatId | null; fullMoon: boolean; victims: SeatId[] }
  | { step: 'massacre'; murderer: SeatId; house: SeatId; victims: SeatId[] }
  | { step: 'shield'; angel: SeatId; charge: SeatId }
  | { step: 'juggernaut'; juggernaut: SeatId; target: SeatId; powerful: boolean; victims: SeatId[] }
  // --- Role-expansion batch E ---
  | { step: 'witch'; witch: SeatId; puppet: SeatId; victim: SeatId; redirected: boolean }
  | { step: 'duel'; pirate: SeatId; target: SeatId; attack: number; success: boolean }
  | { step: 'infect'; plaguebearer: SeatId; infected: SeatId[]; allInfected: boolean }
  | { step: 'retribute'; retributionist: SeatId; target: SeatId; revived: boolean }
  // --- Vampire conversion faction ---
  // A vampire's bite resolved: `converted` true ⇒ the target was turned into a
  // Vampire; false ⇒ the bite failed (immune/already-vampire/non-convertible/the
  // biter was staked by a Vampire Hunter). `staked` true ⇒ the biting vampire died
  // on the Hunter's ward this night.
  | { step: 'convert'; vampire: SeatId; target: SeatId; converted: boolean; staked: boolean }
  // The Vampire Hunter's active check: whether the studied target is a vampire.
  | { step: 'vampire_check'; hunter: SeatId; target: SeatId; isVampire: boolean }
  // --- Cult conversion faction ---
  // The Cult Leader's recruitment resolved: `recruited` true ⇒ the target was drawn
  // into the Cult; false ⇒ the recruit failed (immune/already-cult/non-convertible/
  // unreachable/the Leader died this night/the one-night cooldown was in effect).
  | { step: 'recruit'; leader: SeatId; target: SeatId; recruited: boolean }
  // --- Role-expansion batch F ---
  // The Transporter swapped two seats: everything aimed at `a` was redirected onto
  // `b` and vice-versa. `swapped` false ⇒ a degenerate submission (a===b / a self-
  // target / a dead endpoint / a seat already swapped by a lower-seat Transporter).
  | { step: 'transport'; transporter: SeatId; a: SeatId; b: SeatId; swapped: boolean }
  // The Coroner's autopsy: the dead `target`'s role + the seats that visited it the
  // night it died. `read` false ⇒ the target was not a valid corpse to open.
  | { step: 'autopsy'; coroner: SeatId; target: SeatId; role: RoleId | null; visitors: SeatId[]; read: boolean }
  // The Trapper's snare at `ward`: `caught` is the seat it snapped shut on (the
  // lowest-seat hostile visitor), or null if nothing was caught. `sprung` ⇒ the
  // ward was actually shielded from an attack this night.
  | { step: 'trap'; trapper: SeatId; ward: SeatId; caught: SeatId | null; sprung: boolean }
  | { step: 'promotion'; kind: 'guardian_to_survivor'; seat: SeatId }
  | { step: 'promotion'; kind: 'plaguebearer_to_pestilence'; seat: SeatId }
  // The Vampire Hunter retires to a Vigilante once no vampires remain (role change).
  | { step: 'promotion'; kind: 'hunter_to_vigilante'; seat: SeatId }
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
  | { step: 'promotion'; kind: 'triad_succession'; seat: SeatId; newRole: RoleId }
  | { step: 'promotion'; kind: 'executioner_to_jester'; seat: SeatId }
  | { step: 'promotion'; kind: 'amnesiac_remember'; seat: SeatId; newRole: RoleId }
  | { step: 'win'; reason: WinCheckReason; winners: WinningParty[] };

/** Why a win check fired (for the trace). */
export type WinCheckReason =
  | 'town_elimination'
  | 'mafia_parity'
  | 'triad_parity'
  | 'vampire_parity'
  | 'cult_parity'
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

  /**
   * Triad roster (seat ids), maintained as members die — the Mafia's mirror for
   * the second evil faction. Used for the 'triad' chat entitlement & roster
   * delivery, exactly like {@link mafiaSeats} for the Mafia.
   */
  triadSeats: SeatId[];

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

  /**
   * Cult conversion faction: the nightNumber of the LAST successful recruit (-1 if
   * none yet). Enforces the one-night cooldown — the Cult Leader cannot recruit on
   * the night immediately following a conversion (a recruit on night N forbids a
   * recruit on night N+1). Advance-only; never reset. See DECISIONS.md "Cult
   * conversion faction".
   */
  cultLastRecruitNight: number;

  /** Personal win flags accrued during play (riders awarded at game over). */
  jesterWinners: SeatId[];
  exeWinners: SeatId[];
  /**
   * Pirate (batch E) personal-win seats. Computed at game over from the live
   * state (enough successful plunders AND alive at the end), mirroring the
   * Guardian Angel's gaWinners. Kept as a state field to surface in replays.
   */
  pirateWinners: SeatId[];
  /**
   * Witch (batch E) spoiler-win seats. Computed at game over: a living Witch whose
   * game the Town did NOT win rides the result. Mirrors gaWinners/pirateWinners.
   */
  witchWinners: SeatId[];
  /**
   * Guardian Angel (batch D) personal-win seats. Unlike the jester/exe winners
   * (recorded at a lynch), the GA win is computed at game over from the live state
   * (charge still alive), so this list is populated there. Kept as a state field
   * to mirror the jester/exe pattern and surface in replays.
   */
  gaWinners: SeatId[];

  /** Accumulated resolution traces (full match audit trail). */
  traces: ResolutionTrace[];

  /** Set once the game ends. */
  gameOver: GameOverState | null;
}
