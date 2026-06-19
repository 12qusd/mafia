/**
 * Test harness: build deterministic mini-games and drive the engine through
 * phases without the server. Used by the §12.1 golden + property suites.
 */

import type { GameSetup, RoleId, SeatId } from '@nocturne/shared';
import { DEFAULT_LOBBY_CONFIG } from '@nocturne/shared';
import { init, apply, type GameState, type GameEvent, type NightAbility } from '../src/index.js';
import type { ResolutionTrace } from '../src/state.js';

/**
 * Build a setup with one fixed slot per given role (player count = roles.length).
 * Seat i gets roles[i] deterministically — `init` shuffles, so we instead build
 * the state directly via a custom path: we make a setup whose single slot list is
 * exactly these fixed roles, then *bypass* the shuffle by seeding such that order
 * is preserved is not guaranteed. To get an exact seat→role map for tests we
 * construct the state via init then *reassign* roles explicitly (engine state is
 * plain data), keeping faction in sync.
 */
export function buildSetup(roles: RoleId[]): GameSetup {
  return {
    id: 'test-setup',
    name: 'Test',
    description: 'test',
    minPlayers: roles.length,
    maxPlayers: roles.length,
    townPool: ['CITIZEN'],
    slotsByPlayerCount: {
      [String(roles.length)]: roles.map((role) => ({ kind: 'fixed', role })),
    },
  };
}

const FACTION_OF: Record<RoleId, GameState['seats'][number]['faction']> = {
  CITIZEN: 'TOWN',
  SHERIFF: 'TOWN',
  INVESTIGATOR: 'TOWN',
  LOOKOUT: 'TOWN',
  DOCTOR: 'TOWN',
  ESCORT: 'TOWN',
  JAILOR: 'TOWN',
  VIGILANTE: 'TOWN',
  MAYOR: 'TOWN',
  GODFATHER: 'MAFIA',
  MAFIOSO: 'MAFIA',
  CONSORT: 'MAFIA',
  FRAMER: 'MAFIA',
  SERIAL_KILLER: 'NEUTRAL_KILLING',
  JESTER: 'NEUTRAL_BENIGN',
  EXECUTIONER: 'NEUTRAL_BENIGN',
  SURVIVOR: 'NEUTRAL_BENIGN',
  // --- Role-expansion batch A ---
  CONSIGLIERE: 'MAFIA',
  FORGER: 'MAFIA',
  JANITOR: 'MAFIA',
  BODYGUARD: 'TOWN',
  BLACKMAILER: 'MAFIA',
  VETERAN: 'TOWN',
  // --- Role-expansion batch B ---
  TRACKER: 'TOWN',
  SPY: 'TOWN',
  AMNESIAC: 'NEUTRAL_BENIGN',
  DISGUISER: 'MAFIA',
  ARSONIST: 'NEUTRAL_KILLING',
  // --- Role-expansion batch C ---
  CRUSADER: 'TOWN',
  AMBUSHER: 'MAFIA',
  PSYCHIC: 'TOWN',
  HYPNOTIST: 'MAFIA',
  // --- Role-expansion batch D ---
  WEREWOLF: 'NEUTRAL_KILLING',
  MASS_MURDERER: 'NEUTRAL_KILLING',
  GUARDIAN_ANGEL: 'NEUTRAL_BENIGN',
  JUGGERNAUT: 'NEUTRAL_KILLING',
  // --- Triad faction ---
  DRAGON_HEAD: 'TRIAD',
  ENFORCER: 'TRIAD',
  VANGUARD: 'TRIAD',
  // --- Role-expansion batch E ---
  WITCH: 'NEUTRAL_BENIGN',
  PIRATE: 'NEUTRAL_BENIGN',
  PLAGUEBEARER: 'NEUTRAL_KILLING',
  PESTILENCE: 'NEUTRAL_KILLING',
  // --- Vampire conversion faction ---
  VAMPIRE: 'VAMPIRE',
  VAMPIRE_HUNTER: 'TOWN',
  // --- Cult conversion faction ---
  CULT_LEADER: 'CULT',
  CULTIST: 'CULT',
  // --- Role-expansion batch F ---
  TRANSPORTER: 'TOWN',
  CORONER: 'TOWN',
  TRAPPER: 'TOWN',
};

const USES: Partial<Record<RoleId, { uses: number; self: number }>> = {
  VIGILANTE: { uses: 2, self: 0 },
  JAILOR: { uses: 2, self: 0 },
  SURVIVOR: { uses: 4, self: 4 },
  DOCTOR: { uses: Number.MAX_SAFE_INTEGER, self: 1 },
  JANITOR: { uses: 3, self: 0 },
  VETERAN: { uses: 3, self: 0 },
};

/**
 * Create a game with an EXACT seat→role mapping (deterministic, no shuffle), so
 * golden tests can address seats by index. Returns a state already advanced to
 * DAY_0 (so the first NIGHT can be entered). Executioner targets, if any, must be
 * set by the caller after creation.
 */
export function makeGame(roles: RoleId[], seed = 'seed'): GameState {
  const setup = buildSetup(roles);
  const state = init(setup, seed, { config: DEFAULT_LOBBY_CONFIG });
  // Overwrite the shuffled assignment with the exact mapping.
  state.seats = roles.map((role, seat) => {
    const u = USES[role] ?? { uses: 0, self: 0 };
    return {
      seat,
      name: `Seat ${seat}`,
      role,
      faction: FACTION_OF[role],
      alive: true,
      connected: true,
      afk: false,
      revealed: false,
      lastWill: '',
      deathNote: '',
      usesRemaining: u.uses,
      selfUsesRemaining: u.self,
      mayorRevealed: false,
      silencedForNight: -1,
      exeTarget: null,
      gaTarget: null,
      killCount: 0,
      apparentRole: null,
      doused: false,
      infected: false,
      plunderCount: 0,
      leaving: false,
      stumped: false,
      deathCause: null,
      deathDay: null,
      deathVisitors: [],
    };
  });
  state.mafiaSeats = state.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);
  state.triadSeats = state.seats.filter((s) => s.faction === 'TRIAD').map((s) => s.seat);
  return state;
}

let clock = 1000;
function tick(): number {
  clock += 1000;
  return clock;
}

/** Apply a single event (auto-stamped), returning the new state + effects. */
export function ev(state: GameState, event: Omit<GameEvent, 'ts'>): { state: GameState; effects: ReturnType<typeof apply>['effects'] } {
  return apply(state, { ...event, ts: tick() } as GameEvent);
}

/** Apply only the state, discarding effects. */
export function step(state: GameState, event: Omit<GameEvent, 'ts'>): GameState {
  return ev(state, event).state;
}

/** Advance one phase (phase_end). */
export function endPhase(state: GameState): { state: GameState; effects: ReturnType<typeof apply>['effects'] } {
  return apply(state, { type: 'phase_end', ts: tick() });
}

/** Drive from ASSIGN to the first NIGHT phase. */
export function toFirstNight(state: GameState): GameState {
  let s = state;
  // ASSIGN → DAY_0
  s = endPhase(s).state;
  // DAY_0 → NIGHT
  s = endPhase(s).state;
  return s;
}

/** Submit a night action. */
export function night(state: GameState, seat: SeatId, ability: NightAbility, target: SeatId | null): GameState {
  return step(state, { type: 'night_action', seat, ability, target });
}

/** Resolve the current NIGHT, returning state + all effects emitted at resolution. */
export function resolveNightPhase(state: GameState): { state: GameState; effects: ReturnType<typeof apply>['effects'] } {
  return endPhase(state);
}

/**
 * From a NIGHT phase, resolve it and drive forward (DAWN → DAY_DISCUSSION →
 * DAY_VOTING → next NIGHT) so the caller can submit the following night's
 * actions. Returns the state now in the next NIGHT phase.
 */
export function toNextNight(state: GameState): GameState {
  let s = resolveNightPhase(state).state; // NIGHT → DAWN
  s = endPhase(s).state; // DAWN → DAY_DISCUSSION
  s = endPhase(s).state; // DAY_DISCUSSION → DAY_VOTING
  s = endPhase(s).state; // DAY_VOTING → (no lynch) → next NIGHT
  return s;
}

/** Collect traces from the most recent night resolution (all traces in state). */
export function tracesOf(state: GameState): ResolutionTrace[] {
  return state.traces;
}

/** Find the last kill trace for a target. */
export function killTrace(state: GameState, target: SeatId) {
  return [...state.traces].reverse().find((t) => t.step === 'kill' && t.target === target);
}
