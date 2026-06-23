/**
 * Engine touchpoint isolation (BUILD_SPEC §6, task HARD BOUNDARIES).
 *
 * Every call into `@nocturne/engine` flows through this ONE module so engine
 * integration is localized here. The engine exposes a pure state machine (§6):
 *
 *   init(setup, seed, opts?): GameState
 *   apply(state, event): { state, effects: Effect[] }
 *   nextDeadline(state): { phase, endsAt } | null
 *
 * with Effect = { to: 'public'|'dead'|'mafia'|SeatId[], msg: ServerMessage }.
 *
 * The real engine landed mid-build with a documented JSON-serializable
 * `GameState` (phase, dayNumber, phaseEndsAt, seats[{alive,role,faction,...}],
 * mafiaSeats, gameOver), plus helpers `yourRoleEffect` / `abilityInfoFor` /
 * `roleToNightAbility`. This adapter binds it and derives the `EngineView`
 * helpers (mafia/dead/all seats, phase info, isOver) the server's transport
 * routing and snapshots need from that shape.
 *
 * If the engine is ever absent again (no `init`/`apply`), the adapter falls back
 * to the deterministic in-server reference engine in `./engine-fallback.ts`. See
 * DECISIONS.md.
 */

import type {
  Effect,
  GameSetup,
  GameTick,
  Phase,
  SeatId,
  ServerMessage,
  ResolvedLobbyConfig,
  AbilityInfo,
  RoleId,
} from '@nocturne/shared';

// Opaque to the server: the engine owns GameState's shape.
export type GameState = unknown;

/**
 * Engine input events (BUILD_SPEC §6, §9.1). Every event carries `ts` (the
 * engine's only clock). Player commands are pre-validated by the server (§5.5).
 * Kept permissive so the server compiles against the spec interface; the
 * adapter's `mapEvent` produces the engine's exact tagged shape.
 */
export interface GameEvent {
  type: string;
  ts?: GameTick;
  seat?: SeatId;
  [k: string]: unknown;
}

export interface ApplyResult {
  state: GameState;
  effects: Effect[];
}

export interface Deadline {
  phase: Phase;
  endsAt: GameTick;
}

export interface EngineApi {
  init(setup: GameSetup, seed: string, opts?: EngineInitOpts): GameState;
  apply(state: GameState, event: GameEvent): ApplyResult;
  nextDeadline(state: GameState): Deadline | null;
}

/**
 * Per-seat role preferences (point-unlocked, goal 3), indexed by seat/roster
 * order. Mirrors the engine's `SeatPreference`. Absent ⇒ no preferences ⇒ the
 * seat↔role assignment is byte-identical to the no-preference path. The server
 * gates each entry on the player's lifetime points BEFORE building this (a stale
 * preference from a player below the unlock threshold is dropped upstream).
 */
export interface SeatPreference {
  /**
   * Role ids (as strings — gated upstream from the DB; unknown/stale ids simply
   * never match the drawn multiset and are harmless). Hard-avoided best-effort.
   */
  blacklist: string[];
  /** Role ids soft-weighted toward this seat (non-guaranteed). */
  prefer: string[];
}

export interface EngineInitOpts {
  playerCount?: number;
  names?: string[];
  config?: ResolvedLobbyConfig;
  matchId?: string;
  seatPreferences?: SeatPreference[];
}

/** Per-seat view the server needs for routing, snapshots, and reveals. */
export interface EngineSeatView {
  seat: SeatId;
  name: string;
  role: RoleId;
  faction: string;
  alive: boolean;
  revealed: boolean;
  connected: boolean;
  afk: boolean;
  lastWill: string;
  deathNote: string;
  mayorRevealed: boolean;
  /** 1-based in-game day the seat died, or null if alive (points scaling §4). */
  deathDay: number | null;
  /** Cause of death, or null if alive. */
  deathCause: string | null;
  /** Admin turned this seat into a non-voting town stump (goal 8). */
  stumped: boolean;
}

/** Read-only helpers the server derives from engine state. */
export interface EngineView {
  phaseInfo(state: GameState): { phase: Phase; dayNumber: number; endsAt: GameTick | null };
  mafiaSeats(state: GameState): SeatId[];
  triadSeats(state: GameState): SeatId[];
  deadSeats(state: GameState): SeatId[];
  allSeats(state: GameState): SeatId[];
  isOver(state: GameState): boolean;
  /** Full per-seat view (for role cards, public seat list, persistence). */
  seats(state: GameState): EngineSeatView[];
  /** Build the `your_role` effect for a seat (mafia roster only to mafia, §5). */
  yourRole(state: GameState, seat: SeatId): Effect | null;
  /** Ability-info list for a seat's role card. */
  abilities(state: GameState, seat: SeatId): AbilityInfo[];
  /** Map a client night ability target into the engine's NightAbility key. */
  nightAbilityFor(role: RoleId): string | null;
  /** Game-over winners / per-seat outcomes, or null if not over. */
  gameOver(state: GameState): { winners: string[]; results: { seat: SeatId; role: RoleId; faction: string; outcome: string }[] } | null;
  /**
   * TEST MODE god-view (read-only). Returns the full debug snapshot derived
   * from engine state, or null if the engine cannot supply it (fallback engine
   * supplies a best-effort subset). Never mutates state.
   */
  debugView(state: GameState): DebugViewData | null;
  /** Full accumulated resolution-trace array (defensive copy), or []. */
  debugTraces(state: GameState): unknown[];
  /** Count of accumulated traces (server diffs this across a night). */
  traceCount(state: GameState): number;
}

/** The god-view snapshot shape (mirrors the engine's DebugView; opaque records). */
export interface DebugViewData {
  phase: Phase;
  dayNumber: number;
  nightNumber: number;
  seats: {
    seat: SeatId;
    name: string;
    role: RoleId;
    faction: string;
    alive: boolean;
    revealed: boolean;
    usesRemaining: number | null;
    selfUsesRemaining: number | null;
    nightImmune: boolean;
    mayorRevealed: boolean;
    exeTarget: SeatId | null;
    leaving: boolean;
    connected: boolean;
    afk: boolean;
  }[];
  mafiaRoster: SeatId[];
  intents: { seat: SeatId; ability: string; target: SeatId | null }[];
  jailTarget: SeatId | null;
  pendingJesterGrief: SeatId[] | null;
  voteTallies: { seat: SeatId; weight: number }[];
  votesBySeat: { seat: SeatId; target: SeatId | 'skip' }[];
  trial: { accused: SeatId; verdicts: { seat: SeatId; value: string }[] } | null;
  executionerTargets: { seat: SeatId; target: SeatId }[];
}

export type Engine = EngineApi & EngineView;

// ---------------------------------------------------------------------------
// Real-engine binding + fallback.
// ---------------------------------------------------------------------------

/** The real engine's GameState shape (the fields the server reads). */
interface RealSeat {
  seat: SeatId;
  name: string;
  role: RoleId;
  faction: string;
  alive: boolean;
  revealed: boolean;
  connected: boolean;
  afk: boolean;
  lastWill: string;
  deathNote: string;
  mayorRevealed: boolean;
  deathDay: number | null;
  deathCause: string | null;
  stumped: boolean;
}
interface RealState {
  phase: Phase;
  dayNumber: number;
  phaseEndsAt: GameTick | null;
  seats: RealSeat[];
  mafiaSeats: SeatId[];
  triadSeats: SeatId[];
  gameOver: {
    winners: string[];
    results: { seat: SeatId; role: RoleId; faction: string; outcome: string }[];
  } | null;
}

interface RealEngineModule {
  init: EngineApi['init'];
  apply: EngineApi['apply'];
  nextDeadline: EngineApi['nextDeadline'];
  yourRoleEffect: (state: GameState, seat: RealSeat) => Effect;
  abilityInfoFor: (seat: RealSeat) => AbilityInfo[];
  roleToNightAbility: (role: RoleId) => string | null;
  debugView: (state: GameState) => DebugViewData;
  debugTraces: (state: GameState) => unknown[];
  traceCount: (state: GameState) => number;
}

let bound: Engine | null = null;
let usingFallback = true;

function isRealModule(mod: Record<string, unknown>): boolean {
  return typeof mod.init === 'function' && typeof mod.apply === 'function';
}

function buildRealEngine(mod: RealEngineModule): Engine {
  const rs = (state: GameState): RealState => state as RealState;
  return {
    init: mod.init,
    apply: mod.apply,
    nextDeadline: mod.nextDeadline,
    phaseInfo: (state) => {
      const s = rs(state);
      return { phase: s.phase, dayNumber: s.dayNumber, endsAt: s.phaseEndsAt };
    },
    mafiaSeats: (state) => rs(state).mafiaSeats.filter((seat) => rs(state).seats[seat]?.alive),
    triadSeats: (state) => rs(state).triadSeats.filter((seat) => rs(state).seats[seat]?.alive),
    deadSeats: (state) => rs(state).seats.filter((x) => !x.alive).map((x) => x.seat),
    allSeats: (state) => rs(state).seats.map((x) => x.seat),
    isOver: (state) => rs(state).gameOver !== null,
    seats: (state) =>
      rs(state).seats.map((x) => ({
        seat: x.seat,
        name: x.name,
        role: x.role,
        faction: x.faction,
        alive: x.alive,
        revealed: x.revealed,
        connected: x.connected,
        afk: x.afk,
        lastWill: x.lastWill,
        deathNote: x.deathNote,
        mayorRevealed: x.mayorRevealed,
        deathDay: x.deathDay ?? null,
        deathCause: x.deathCause ?? null,
        stumped: x.stumped ?? false,
      })),
    yourRole: (state, seat) => {
      const s = rs(state).seats[seat];
      return s ? mod.yourRoleEffect(state, s) : null;
    },
    abilities: (state, seat) => {
      const s = rs(state).seats[seat];
      return s ? mod.abilityInfoFor(s) : [];
    },
    nightAbilityFor: (role) => mod.roleToNightAbility(role),
    gameOver: (state) => rs(state).gameOver,
    debugView: (state) => (typeof mod.debugView === 'function' ? mod.debugView(state) : null),
    debugTraces: (state) => (typeof mod.debugTraces === 'function' ? mod.debugTraces(state) : []),
    traceCount: (state) => (typeof mod.traceCount === 'function' ? mod.traceCount(state) : 0),
  };
}

export async function getEngine(): Promise<Engine> {
  if (bound) return bound;
  let realMod: RealEngineModule | null = null;
  try {
    const mod = (await import('@nocturne/engine')) as Record<string, unknown>;
    if (isRealModule(mod) && typeof mod.yourRoleEffect === 'function') {
      realMod = mod as unknown as RealEngineModule;
    }
  } catch {
    realMod = null;
  }

  if (realMod) {
    usingFallback = false;
    bound = buildRealEngine(realMod);
  } else {
    usingFallback = true;
    const { makeFallbackEngine } = await import('./engine-fallback.js');
    bound = makeFallbackEngine();
  }
  return bound;
}

export function isUsingFallbackEngine(): boolean {
  return usingFallback;
}

export function _resetEngineBindingForTests(): void {
  bound = null;
  usingFallback = true;
}

export type { ResolvedLobbyConfig, ServerMessage };
