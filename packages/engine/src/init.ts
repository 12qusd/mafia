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
  RANDOM_TRIAD_POOL,
  DEFAULT_LOBBY_CONFIG,
  type ResolvedLobbyConfig,
  VIGILANTE_BULLETS,
  JAILOR_EXECUTIONS,
  SURVIVOR_VESTS,
  DOCTOR_SELF_HEALS,
  JANITOR_CLEANS,
  VETERAN_ALERTS,
} from '@nocturne/shared';
import type { GameState, SeatState } from './state.js';
import { seedPrng, shuffle, pick, nextFloat, nextInt, type PrngState } from './prng.js';

/**
 * A single seat's point-unlocked role preferences (goal 3), indexed by seat in
 * {@link InitOptions.seatPreferences}. `blacklist` roles are hard-avoided
 * (best-effort, non-guaranteed); `prefer` roles are soft-weighted toward the
 * seat. The role MULTISET is fixed by the setup — preferences only influence the
 * seat↔role permutation, never which roles are in the game.
 */
export interface SeatPreference {
  /**
   * Role ids the seat hard-avoids (best-effort). Typed as `string[]`: the values
   * are compared by set-membership against the drawn multiset, so an unknown or
   * stale id simply never matches and is harmless (the server gates these against
   * the player's unlock tier before they reach here).
   */
  blacklist: string[];
  /** Role ids soft-weighted toward this seat (non-guaranteed). */
  prefer: string[];
}

export interface InitOptions {
  /** Player count (defaults to the unique slot list if the setup has one). */
  playerCount?: number;
  /** Display names per seat (defaults to "Seat N"). */
  names?: string[];
  /** Resolved lobby config (defaults to DEFAULT_LOBBY_CONFIG). */
  config?: ResolvedLobbyConfig;
  /** Match id (opaque; default derived from seed). */
  matchId?: string;
  /**
   * Per-seat role preferences (point-unlocked, goal 3), indexed by seat/roster
   * order. ABSENT (or an all-empty array) ⇒ no preferences ⇒ the seat↔role
   * assignment is byte-identical to the no-preference path (determinism +
   * golden + composition tests stay green). Only the seat↔role permutation is
   * affected; the role multiset drawn from the setup is never changed. See
   * {@link assignWithPreferences}.
   */
  seatPreferences?: SeatPreference[];
}

/** True if at least one seat declares at least one blacklist/prefer entry. */
function hasAnyPreference(prefs: readonly SeatPreference[] | undefined): boolean {
  if (!prefs) return false;
  return prefs.some((p) => p.blacklist.length > 0 || p.prefer.length > 0);
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
  seatPreferences: readonly SeatPreference[] | undefined,
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
  //
  // The baseline Fisher–Yates shuffle is ALWAYS run and consumes the PRNG
  // exactly as before — this guarantees that the no-preference path (the
  // default for every existing call site, test, and bot sim) is byte-identical
  // to the prior behavior. Only when at least one seat declares a preference do
  // we further advance the PRNG and re-derive the permutation; otherwise we
  // return the baseline shuffle untouched.
  const sh = shuffle(state, placed);
  state = sh.state;
  let roles = sh.value;

  if (hasAnyPreference(seatPreferences)) {
    const res = assignWithPreferences(roles, seatPreferences!, state);
    roles = res.roles;
    state = res.prng;
  }

  return { roles, prng: state };
}

/**
 * Preference-aware, deterministic seat↔role assignment (goal 3).
 *
 * Inputs: the baseline seat→role array (the fixed multiset already shuffled),
 * the per-seat preferences, and the current PRNG state. Output: a permutation of
 * the SAME multiset (counts unchanged) that (a) hard-avoids blacklisted pairings
 * when a conflict-free assignment exists, minimizing violations otherwise, and
 * (b) soft-weights preferred roles toward seats that want them. Fully
 * deterministic: same (roles, prefs, prng) ⇒ identical result.
 *
 * Algorithm — a seeded greedy assignment with weighted tie-breaking:
 *
 *  1. Build the role multiset to distribute (a flat list of the roles to place,
 *     one per seat). Determine, per seat, the set of DISTINCT roles available and
 *     whether each is blacklisted / preferred by that seat.
 *  2. Order the seats by a deterministic "constrainedness" key (fewest
 *     non-blacklisted distinct roles first, ties broken by seat index) so the
 *     hardest-to-satisfy seats are assigned while the most options remain — this
 *     is what lets the greedy pass find a conflict-free assignment whenever one
 *     exists for the common (sparse-blacklist) case.
 *  3. For each seat in that order, choose a role from the remaining pool:
 *       - candidates = remaining roles NOT blacklisted by the seat; if that set
 *         is empty (over-constrained), fall back to ALL remaining roles (a
 *         blacklist violation — the documented non-guarantee).
 *       - weight each candidate: preferred roles get PREFER_WEIGHT, others get 1.
 *       - draw one candidate with a single seeded PRNG step over the cumulative
 *         weights. This biases toward preferred roles without guaranteeing them,
 *         and the seeded draw keeps the whole thing deterministic.
 *  4. Remove the chosen role instance from the remaining pool and continue.
 *
 * Greedy (not full backtracking) is sufficient here: blacklists are sparse
 * (a handful of roles out of 50) and seats are few (≤15), so the
 * most-constrained-first ordering finds a zero-violation assignment in every
 * realistic case; when blacklists are genuinely over-constrained (more seats
 * blacklist a role than there are non-blacklisters for the complementary roles)
 * SOME violation is unavoidable and we accept the minimum the greedy yields.
 */
function assignWithPreferences(
  baseRoles: readonly RoleId[],
  prefs: readonly SeatPreference[],
  prng: PrngState,
): { roles: RoleId[]; prng: PrngState } {
  const n = baseRoles.length;
  let state = prng;

  // Per-seat preference lookup (absent seats ⇒ empty sets). Sets of plain
  // strings: a stale/unknown id just never matches the drawn multiset.
  const blacklistOf = (seat: number): ReadonlySet<string> =>
    new Set(prefs[seat]?.blacklist ?? []);
  const preferOf = (seat: number): ReadonlySet<string> => new Set(prefs[seat]?.prefer ?? []);
  const seatBlack: ReadonlySet<string>[] = [];
  const seatPrefer: ReadonlySet<string>[] = [];
  for (let s = 0; s < n; s++) {
    seatBlack.push(blacklistOf(s));
    seatPrefer.push(preferOf(s));
  }

  // Remaining role pool (counts mirror the input multiset).
  const remaining: RoleId[] = baseRoles.slice();

  // Distinct non-blacklisted option count for a seat, given the current pool —
  // used for the most-constrained-first ordering.
  const optionCount = (seat: number, pool: readonly RoleId[]): number => {
    const black = seatBlack[seat]!;
    const distinct = new Set<RoleId>();
    for (const r of pool) if (!black.has(r)) distinct.add(r);
    return distinct.size;
  };

  // Assignment order: most-constrained seat first (fewest legal distinct roles),
  // ties by ascending seat index for determinism. Computed once against the full
  // pool — a stable, deterministic order independent of the PRNG.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ca = optionCount(a, baseRoles);
    const cb = optionCount(b, baseRoles);
    if (ca !== cb) return ca - cb;
    return a - b;
  });

  const result: (RoleId | null)[] = new Array<RoleId | null>(n).fill(null);

  for (const seat of order) {
    const black = seatBlack[seat]!;
    const prefer = seatPrefer[seat]!;

    // Candidate INDICES into `remaining` that are not blacklisted by this seat.
    let candidateIdx: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (!black.has(remaining[i]!)) candidateIdx.push(i);
    }
    // Over-constrained: no non-blacklisted role left ⇒ accept a violation and
    // pick from everything that remains (minimized by the ordering above).
    if (candidateIdx.length === 0) {
      candidateIdx = remaining.map((_, i) => i);
    }

    // Weighted seeded draw: preferred roles weigh PREFER_WEIGHT, others 1.
    const weights = candidateIdx.map((i) => (prefer.has(remaining[i]!) ? PREFER_WEIGHT : 1));
    const draw = weightedPick(state, weights);
    state = draw.prng;
    const chosenIdx = candidateIdx[draw.index]!;
    result[seat] = remaining[chosenIdx]!;
    remaining.splice(chosenIdx, 1);
  }

  // Every seat assigned; the multiset is preserved by construction (we only ever
  // removed instances from `remaining`).
  return { roles: result.map((r) => r as RoleId), prng: state };
}

/** Soft-weight multiplier for a preferred role in the weighted draw. */
const PREFER_WEIGHT = 4;

/**
 * Pick an index in [0, weights.length) with probability proportional to its
 * weight, using one seeded PRNG step. Deterministic. All weights must be > 0 and
 * the array non-empty (callers guarantee this). Returns the advanced state.
 */
function weightedPick(
  state: PrngState,
  weights: readonly number[],
): { prng: PrngState; index: number } {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) {
    // Defensive: degenerate to a uniform pick (shouldn't happen — weights ≥ 1).
    const r = nextInt(state, weights.length);
    return { prng: r.state, index: r.value };
  }
  const { state: s2, value } = nextFloat(state);
  let threshold = value * total;
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i]!;
    if (threshold < 0) return { prng: s2, index: i };
  }
  // Floating-point edge: return the last index.
  return { prng: s2, index: weights.length - 1 };
}

function categoryPool(category: string, setup: GameSetup): RoleId[] {
  if (category === 'RANDOM_MAFIA') return RANDOM_MAFIA_POOL.slice();
  if (category === 'RANDOM_TRIAD') return RANDOM_TRIAD_POOL.slice();
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
    default:
      return { uses: 0, self: 0 };
  }
}

/** Build the engine's initial GameState. */
export function init(setup: GameSetup, seed: string, opts: InitOptions = {}): GameState {
  const slots = slotsFor(setup, opts.playerCount);
  const playerCount = slots.length;

  let prng = seedPrng(seed);
  const assigned = assignRoles(slots, setup, prng, opts.seatPreferences);
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

  // Guardian Angel target assignment (batch D): one random NON-EVIL charge, never
  // the GA itself nor another Guardian Angel. "Non-evil" excludes MAFIA, TRIAD and
  // NEUTRAL_KILLING (you cannot be tied to protect a killer); Town and other
  // benigns are valid charges. If no valid charge exists, the GA has no one to
  // watch over and becomes a Survivor immediately.
  for (const s of seats) {
    if (s.role === 'GUARDIAN_ANGEL') {
      const candidates = seats
        .filter(
          (c) =>
            c.seat !== s.seat &&
            c.role !== 'GUARDIAN_ANGEL' &&
            c.faction !== 'MAFIA' &&
            c.faction !== 'TRIAD' &&
            c.faction !== 'NEUTRAL_KILLING',
        )
        .map((c) => c.seat);
      if (candidates.length > 0) {
        const r = pick(prng, candidates);
        prng = r.state;
        s.gaTarget = r.value;
      } else {
        s.role = 'SURVIVOR';
        s.faction = 'NEUTRAL_BENIGN';
        const u = initialUses('SURVIVOR');
        s.usesRemaining = u.uses;
        s.selfUsesRemaining = u.self;
      }
    }
  }

  const mafiaSeats = seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);
  const triadSeats = seats.filter((s) => s.faction === 'TRIAD').map((s) => s.seat);

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
    triadSeats,
    nightIntents: [],
    jailTarget: null,
    nomination: { votes: [], trialsUsed: 0, pausedRemainingMs: null },
    trial: null,
    pendingJesterGrief: null,
    quietNights: 0,
    cultLastRecruitNight: -1,
    jesterWinners: [],
    exeWinners: [],
    gaWinners: [],
    pirateWinners: [],
    witchWinners: [],
    traces: [],
    gameOver: null,
  };

  void playerCount;
  return state;
}
