/**
 * Role assignment & match initialization (BUILD_SPEC §6.10, §6).
 *
 * `init(setup, seed)` assigns roles via the slot system using the match PRNG,
 * honoring RANDOM_TOWN / RANDOM_MAFIA pools, unique-role constraints, and the
 * Executioner target assignment (excludes Jailor + Town-only).
 *
 * The number of players is taken from the setup's slot list — the server passes a
 * setup already scoped to the locked roster size. We infer player count from the
 * single slot list whose length we resolve via the optional `playerCount`.
 */

import {
  type GameSetup,
  type RoleId,
  type SetupSlot,
  type Faction,
  ROLES,
  UNIQUE_ROLES,
  RANDOM_MAFIA_POOL,
  DEFAULT_LOBBY_CONFIG,
  type ResolvedLobbyConfig,
  VIGILANTE_BULLETS,
  JAILOR_EXECUTIONS,
  SURVIVOR_VESTS,
  DOCTOR_SELF_HEALS,
  JANITOR_CLEANS,
  VETERAN_ALERTS,
  MEDIUM_SEANCES,
} from '@nocturne/shared';
import type { GameState, SeatState } from './state.js';
import { seedPrng, shuffle, pick, type PrngState } from './prng.js';

export interface InitOptions {
  /** Player count (defaults to the unique slot list if the setup has one). */
  playerCount?: number;
  /** Display names per seat (defaults to "Seat N"). */
  names?: string[];
  /** Resolved lobby config (defaults to DEFAULT_LOBBY_CONFIG). */
  config?: ResolvedLobbyConfig;
  /** Match id (opaque; default derived from seed). */
  matchId?: string;
}

/** Resolve the slot list for the given player count. */
function slotsFor(setup: GameSetup, playerCount: number | undefined): SetupSlot[] {
  if (playerCount !== undefined) {
    const s = setup.slotsByPlayerCount[String(playerCount)];
    if (!s) throw new Error(`engine: setup ${setup.id} has no slots for ${playerCount} players`);
    return s.slice();
  }
  const keys = Object.keys(setup.slotsByPlayerCount);
  if (keys.length !== 1) {
    throw new Error(`engine: setup ${setup.id} spans multiple counts; pass playerCount`);
  }
  return setup.slotsByPlayerCount[keys[0]!]!.slice();
}

/**
 * Assign concrete roles to slots. Returns the role per seat index.
 *
 * Algorithm (deterministic via PRNG):
 *  1. First place all fixed-role slots.
 *  2. For each category slot, draw a role from its pool honoring unique-role
 *     constraints (a unique role already placed is excluded from the pool).
 *  3. Shuffle the resulting role list across seats so seat↔role mapping is
 *     randomized (players don't infer role from slot position).
 */
function assignRoles(
  slots: readonly SetupSlot[],
  setup: GameSetup,
  prng: PrngState,
): { roles: RoleId[]; prng: PrngState } {
  let state = prng;
  const placed: RoleId[] = [];
  const usedUnique = new Set<RoleId>();

  // Pass 1: fixed slots.
  for (const slot of slots) {
    if (slot.kind === 'fixed') {
      placed.push(slot.role);
      if (UNIQUE_ROLES.includes(slot.role)) usedUnique.add(slot.role);
    }
  }

  // Pass 2: category slots.
  for (const slot of slots) {
    if (slot.kind !== 'category') continue;
    const pool = categoryPool(slot.category, setup).filter(
      (r) => !(UNIQUE_ROLES.includes(r) && usedUnique.has(r)),
    );
    if (pool.length === 0) {
      throw new Error(`engine: empty pool for ${slot.category} in ${setup.id}`);
    }
    const r = pick(state, pool);
    state = r.state;
    placed.push(r.value);
    if (UNIQUE_ROLES.includes(r.value)) usedUnique.add(r.value);
  }

  // Pass 3: shuffle role list across seats.
  const sh = shuffle(state, placed);
  state = sh.state;
  return { roles: sh.value, prng: state };
}

function categoryPool(category: string, setup: GameSetup): RoleId[] {
  if (category === 'RANDOM_MAFIA') return RANDOM_MAFIA_POOL.slice();
  // RANDOM_TOWN: draw from setup's town allowlist.
  return setup.townPool.slice();
}

/** Initial metered uses for a role. */
export function initialUses(role: RoleId): { uses: number; self: number } {
  switch (role) {
    case 'VIGILANTE':
      return { uses: VIGILANTE_BULLETS, self: 0 };
    case 'JAILOR':
      return { uses: JAILOR_EXECUTIONS, self: 0 };
    case 'SURVIVOR':
      return { uses: SURVIVOR_VESTS, self: SURVIVOR_VESTS };
    case 'DOCTOR':
      return { uses: Number.MAX_SAFE_INTEGER, self: DOCTOR_SELF_HEALS };
    case 'JANITOR':
      return { uses: JANITOR_CLEANS, self: 0 };
    case 'VETERAN':
      return { uses: VETERAN_ALERTS, self: 0 };
    case 'MEDIUM':
      return { uses: MEDIUM_SEANCES, self: 0 };
    default:
      return { uses: 0, self: 0 };
  }
}

/** Build the engine's initial GameState. */
export function init(setup: GameSetup, seed: string, opts: InitOptions = {}): GameState {
  const slots = slotsFor(setup, opts.playerCount);
  const playerCount = slots.length;

  let prng = seedPrng(seed);
  const assigned = assignRoles(slots, setup, prng);
  prng = assigned.prng;
  const roles = assigned.roles;

  const config = opts.config ?? DEFAULT_LOBBY_CONFIG;

  const seats: SeatState[] = roles.map((role, seat) => {
    const def = ROLES[role];
    const faction: Faction = def.faction;
    const uses = initialUses(role);
    return {
      seat,
      name: opts.names?.[seat] ?? `Seat ${seat}`,
      role,
      faction,
      alive: true,
      connected: true,
      afk: false,
      revealed: false,
      lastWill: '',
      deathNote: '',
      usesRemaining: uses.uses,
      selfUsesRemaining: uses.self,
      mayorRevealed: false,
      silencedForNight: -1,
      exeTarget: null,
      apparentRole: null,
      doused: false,
      leaving: false,
      stumped: false,
      deathCause: null,
      deathDay: null,
    };
  });

  // Executioner target assignment: one random Town seat, never the Jailor.
  for (const s of seats) {
    if (s.role === 'EXECUTIONER') {
      const candidates = seats
        .filter((c) => c.faction === 'TOWN' && c.role !== 'JAILOR')
        .map((c) => c.seat);
      if (candidates.length > 0) {
        const r = pick(prng, candidates);
        prng = r.state;
        s.exeTarget = r.value;
      } else {
        // No valid town target ⇒ becomes a Jester immediately.
        s.role = 'JESTER';
        s.faction = 'NEUTRAL_BENIGN';
      }
    }
  }

  const mafiaSeats = seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);

  const state: GameState = {
    version: 1,
    setupId: setup.id,
    seed,
    matchId: opts.matchId ?? `match-${seed}`,
    config,
    prng,
    phase: 'ASSIGN',
    dayNumber: 0,
    nightNumber: 0,
    phaseEndsAt: null,
    lastTick: 0,
    seats,
    mafiaSeats,
    nightIntents: [],
    jailTarget: null,
    seanceMedium: null,
    nomination: { votes: [], trialsUsed: 0, pausedRemainingMs: null },
    trial: null,
    pendingJesterGrief: null,
    quietNights: 0,
    jesterWinners: [],
    exeWinners: [],
    traces: [],
    gameOver: null,
  };

  void playerCount;
  return state;
}
