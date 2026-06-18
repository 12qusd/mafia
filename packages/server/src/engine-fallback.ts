/**
 * Deterministic in-server REFERENCE engine (fallback only).
 *
 * The authoritative engine is `@nocturne/engine`, built concurrently (§6). Until
 * it lands, this module lets the server's lobby/room/transport/loop code run end
 * to end and lets non-engine tests pass. It is intentionally a simplified-but-
 * deterministic subset of §6: seeded role assignment, the §6.1 phase machine,
 * open day voting → trial → execution, a single nightly mafia/SK/vigilante kill
 * pass (no full §6.8 fixed-point resolver), and §6.9 win checks for Town/Mafia/
 * SK plus a stalemate guard. It is NOT a substitute for the real engine's rules
 * fidelity; see DECISIONS.md.
 *
 * All randomness flows from the injected seed (§2.2). No Date.now / Math.random.
 */

import {
  ROLES,
  DEFAULT_LOBBY_CONFIG,
  MAYOR_VOTE_WEIGHT,
  DEFAULT_VOTE_WEIGHT,
  STALEMATE_QUIET_NIGHTS,
  type Effect,
  type GameSetup,
  type GameTick,
  type Phase,
  type SeatId,
  type RoleId,
  type Faction,
  type ResolvedLobbyConfig,
  type SetupSlot,
  type ServerMessage,
} from '@nocturne/shared';
import type {
  Engine,
  GameState,
  GameEvent,
  ApplyResult,
  Deadline,
  EngineSeatView,
} from './engine-adapter.js';
import type { AbilityInfo } from '@nocturne/shared';

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32 over a hashed seed) — deterministic, no I/O.
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Fallback state shape (the server treats GameState as opaque; this is internal).
// ---------------------------------------------------------------------------

interface SeatState {
  seat: SeatId;
  role: RoleId;
  faction: Faction;
  alive: boolean;
  revealed: boolean;
  mayorRevealed: boolean;
  leaving: boolean;
}

interface FallbackState {
  setupId: string;
  seed: string;
  config: ResolvedLobbyConfig;
  phase: Phase;
  dayNumber: number;
  endsAt: GameTick | null;
  seats: SeatState[];
  // open day voting: seat -> target ('skip' or seat)
  votes: Map<SeatId, SeatId | 'skip'>;
  // trial
  accused: SeatId | null;
  verdicts: Map<SeatId, 'guilty' | 'innocent' | 'abstain'>;
  trialsToday: number;
  // night
  nightKills: Map<SeatId, SeatId>; // source seat -> target
  quietNights: number;
  over: boolean;
}

function asFallback(state: GameState): FallbackState {
  return state as FallbackState;
}

function v(type: string, payload: Record<string, unknown>): ServerMessage {
  return { v: 1, type, ...payload } as unknown as ServerMessage;
}

function livingSeats(s: FallbackState): SeatState[] {
  return s.seats.filter((x) => x.alive);
}

function mafiaLiving(s: FallbackState): SeatState[] {
  return livingSeats(s).filter((x) => x.faction === 'MAFIA');
}

function skLiving(s: FallbackState): SeatState[] {
  return livingSeats(s).filter((x) => x.faction === 'NEUTRAL_KILLING');
}

// ---------------------------------------------------------------------------
// Role assignment (§6.10) — fixed slots verbatim; category slots drawn by PRNG.
// ---------------------------------------------------------------------------

function resolveSlots(slots: readonly SetupSlot[], rnd: () => number): RoleId[] {
  const out: RoleId[] = [];
  for (const slot of slots) {
    if (slot.kind === 'fixed') {
      out.push(slot.role);
    } else if (slot.category === 'RANDOM_MAFIA') {
      const pool: RoleId[] = ['CONSORT', 'FRAMER'];
      out.push(pool[Math.floor(rnd() * pool.length)] as RoleId);
    } else {
      // RANDOM_TOWN — draw from the role registry's Town roles, excluding uniques
      // already chosen would require setup context; MVP setups don't use it.
      const town = (Object.keys(ROLES) as RoleId[]).filter((r) => ROLES[r].faction === 'TOWN');
      out.push(town[Math.floor(rnd() * town.length)] as RoleId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine implementation.
// ---------------------------------------------------------------------------

function init(setup: GameSetup, seed: string): GameState {
  const rnd = mulberry32(hashSeed(seed));
  // The server passes a setup whose slotsByPlayerCount has exactly one entry
  // for the locked roster size (room composes this). Pick the single slot list.
  const counts = Object.keys(setup.slotsByPlayerCount);
  const playerCount = counts.length === 1 ? Number(counts[0]) : Math.max(...counts.map(Number));
  const slots = setup.slotsByPlayerCount[String(playerCount)] ?? [];
  const roles = shuffle(resolveSlots(slots, rnd), rnd);
  const seats: SeatState[] = roles.map((role, i) => ({
    seat: i,
    role,
    faction: ROLES[role].faction,
    alive: true,
    revealed: false,
    mayorRevealed: false,
    leaving: false,
  }));
  const s: FallbackState = {
    setupId: setup.id,
    seed,
    config: DEFAULT_LOBBY_CONFIG,
    phase: 'DAY_0',
    dayNumber: 0,
    endsAt: null,
    seats,
    votes: new Map(),
    accused: null,
    verdicts: new Map(),
    trialsToday: 0,
    nightKills: new Map(),
    quietNights: 0,
    over: false,
  };
  s.phase = 'ASSIGN';
  return s;
}

function voteWeight(seat: SeatState): number {
  return seat.mayorRevealed ? MAYOR_VOTE_WEIGHT : DEFAULT_VOTE_WEIGHT;
}

function tallyEffects(s: FallbackState): Effect[] {
  const tallies = new Map<SeatId, number>();
  const votesBySeat: { seat: SeatId; target: SeatId | 'skip' }[] = [];
  for (const [voter, target] of s.votes) {
    votesBySeat.push({ seat: voter, target });
    if (target !== 'skip') {
      const w = voteWeight(s.seats[voter] as SeatState);
      tallies.set(target, (tallies.get(target) ?? 0) + w);
    }
  }
  return [
    {
      to: 'public',
      msg: v('vote_update', {
        tallies: [...tallies].map(([seat, weight]) => ({ seat, weight })),
        votesBySeat,
      }),
    },
  ];
}

function winCheck(s: FallbackState): Effect[] | null {
  const living = livingSeats(s);
  const mafia = mafiaLiving(s).length;
  const sk = skLiving(s).length;
  const benign = living.filter((x) => x.faction === 'NEUTRAL_BENIGN').length;
  let winners: string[] | null = null;

  if (mafia === 0 && sk === 0) winners = ['TOWN'];
  else if (sk > 0 && living.length === sk + benign) winners = ['SERIAL_KILLER'];
  else if (sk === 0 && mafia >= living.length - mafia) winners = ['MAFIA'];

  if (!winners) return null;
  s.over = true;
  s.phase = 'GAME_OVER';
  s.endsAt = null;
  const allRoles = s.seats.map((x) => ({
    seat: x.seat,
    role: x.role,
    faction: x.faction,
    outcome: winners?.includes(x.faction === 'MAFIA' ? 'MAFIA' : 'TOWN') ? 'win' : 'loss',
  }));
  return [
    {
      to: 'public',
      msg: v('game_over', { winners, allRoles, seed: s.seed, matchId: '' }),
    },
  ];
}

function killSeat(s: FallbackState, seat: SeatId, cause: string): Effect[] {
  const st = s.seats[seat];
  if (!st || !st.alive) return [];
  st.alive = false;
  st.revealed = true;
  return [
    {
      to: 'public',
      msg: v('death_announce', { seat, role: st.role, cause }),
    },
  ];
}

function resolveNight(s: FallbackState): Effect[] {
  const effects: Effect[] = [];
  const order: SeatId[] = [];
  // Fixed report order subset: vigilante, mafia, serial_killer (§6.8 step 5).
  const byFaction = (f: Faction) => [...s.nightKills].filter(([src]) => s.seats[src]?.faction === f);
  for (const [, t] of byFaction('TOWN')) order.push(t); // vigilante etc.
  for (const [, t] of byFaction('MAFIA')) order.push(t);
  for (const [, t] of byFaction('NEUTRAL_KILLING')) order.push(t);
  // leavers suicide (§8)
  for (const st of s.seats) if (st.alive && st.leaving) order.push(st.seat);

  const deaths = new Set<SeatId>();
  for (const t of order) {
    const target = s.seats[t];
    if (target && target.alive && !deaths.has(t)) {
      if (target.faction === 'NEUTRAL_KILLING' || target.role === 'GODFATHER') continue;
      deaths.add(t);
    }
  }
  for (const st of s.seats) if (st.leaving && st.alive) deaths.add(st.seat);

  if (deaths.size === 0) s.quietNights += 1;
  else s.quietNights = 0;

  for (const seat of deaths) {
    const st = s.seats[seat];
    effects.push(...killSeat(s, seat, st?.leaving ? 'leave' : 'mafia'));
  }
  s.nightKills.clear();
  return effects;
}

function advancePhase(s: FallbackState, now: GameTick): { phase: Phase; effects: Effect[] } {
  const effects: Effect[] = [];
  const cfg = s.config;
  const dur = (sec: number | undefined): GameTick => now + (sec ?? 30) * 1000;

  switch (s.phase) {
    case 'ASSIGN':
      s.phase = 'DAY_0';
      s.dayNumber = 0;
      s.endsAt = dur(cfg.timings.DAY_0);
      break;
    case 'DAY_0':
      s.phase = 'NIGHT';
      s.dayNumber = 1;
      s.endsAt = dur(cfg.timings.NIGHT);
      break;
    case 'NIGHT': {
      const deaths = resolveNight(s);
      const win = winCheck(s);
      if (win) {
        effects.push(...win);
        s.endsAt = null;
        break;
      }
      s.phase = 'DAWN';
      effects.push(...deaths);
      s.endsAt = dur(8 + deaths.length * 4);
      break;
    }
    case 'DAWN':
      s.phase = 'DAY_DISCUSSION';
      s.endsAt = dur(cfg.timings.DAY_DISCUSSION);
      break;
    case 'DAY_DISCUSSION':
      s.phase = 'DAY_VOTING';
      s.votes.clear();
      s.trialsToday = 0;
      s.endsAt = dur(cfg.timings.DAY_VOTING);
      effects.push(...tallyEffects(s));
      break;
    case 'DAY_VOTING':
      // No majority reached by deadline → night.
      s.phase = 'NIGHT';
      s.endsAt = dur(cfg.timings.NIGHT);
      break;
    case 'TRIAL_DEFENSE':
      s.phase = 'TRIAL_JUDGMENT';
      s.verdicts.clear();
      s.endsAt = dur(cfg.timings.TRIAL_JUDGMENT);
      break;
    case 'TRIAL_JUDGMENT': {
      let guilty = 0;
      let innocent = 0;
      for (const [voter, val] of s.verdicts) {
        const w = voteWeight(s.seats[voter] as SeatState);
        if (val === 'guilty') guilty += w;
        else if (val === 'innocent') innocent += w;
      }
      const outcome = guilty > innocent ? 'guilty' : 'innocent';
      effects.push({
        to: 'public',
        msg: v('verdict_result', {
          accusedSeat: s.accused,
          outcome,
          votes: [...s.verdicts].map(([seat, value]) => ({ seat, value })),
        }),
      });
      if (outcome === 'guilty') {
        s.phase = 'EXECUTION';
        s.endsAt = dur(12);
      } else {
        s.accused = null;
        if (s.trialsToday >= 3) {
          s.phase = 'NIGHT';
          s.endsAt = dur(cfg.timings.NIGHT);
        } else {
          s.phase = 'DAY_VOTING';
          s.votes.clear();
          s.endsAt = dur(cfg.timings.DAY_VOTING);
          effects.push(...tallyEffects(s));
        }
      }
      break;
    }
    case 'EXECUTION': {
      if (s.accused !== null) effects.push(...killSeat(s, s.accused, 'lynch'));
      s.accused = null;
      const win = winCheck(s);
      if (win) {
        effects.push(...win);
        s.endsAt = null;
        break;
      }
      s.phase = 'NIGHT';
      s.endsAt = dur(cfg.timings.NIGHT);
      break;
    }
    default:
      s.endsAt = null;
  }

  // stalemate guard (§6.9)
  if (!s.over && s.quietNights >= STALEMATE_QUIET_NIGHTS) {
    const win = winCheck(s) ?? [
      { to: 'public' as const, msg: v('game_over', { winners: ['DRAW'], allRoles: [], seed: s.seed, matchId: '' }) },
    ];
    s.over = true;
    s.phase = 'GAME_OVER';
    s.endsAt = null;
    effects.push(...win);
  }
  return { phase: s.phase, effects };
}

function apply(state: GameState, event: GameEvent): ApplyResult {
  const s = asFallback(state);
  const effects: Effect[] = [];
  const now = (event.ts as GameTick | undefined) ?? (event.now as GameTick | undefined) ?? Date.now();

  switch (event.type) {
    case 'phase_end': {
      const r = advancePhase(s, now);
      effects.push(...r.effects);
      break;
    }
    case 'vote': {
      const seat = event.seat as SeatId;
      const target = event.target as SeatId | 'skip' | null;
      if (s.phase !== 'DAY_VOTING') break;
      if (target === null) s.votes.delete(seat);
      else s.votes.set(seat, target);
      effects.push(...tallyEffects(s));
      // majority check
      const living = livingSeats(s);
      const totalWeight = living.reduce((a, x) => a + voteWeight(x), 0);
      const threshold = Math.floor(totalWeight / 2) + 1;
      const counts = new Map<SeatId, number>();
      for (const [voter, tgt] of s.votes) {
        if (tgt !== 'skip')
          counts.set(tgt, (counts.get(tgt) ?? 0) + voteWeight(s.seats[voter] as SeatState));
      }
      for (const [tgt, w] of counts) {
        if (w >= threshold) {
          s.accused = tgt;
          s.trialsToday += 1;
          s.phase = 'TRIAL_DEFENSE';
          s.endsAt = now + (s.config.timings.TRIAL_DEFENSE ?? 25) * 1000;
          effects.push({ to: 'public', msg: v('trial_start', { accusedSeat: tgt }) });
          break;
        }
      }
      break;
    }
    case 'verdict': {
      if (s.phase !== 'TRIAL_JUDGMENT') break;
      const seat = event.seat as SeatId;
      if (seat === s.accused) break;
      s.verdicts.set(seat, event.value as 'guilty' | 'innocent' | 'abstain');
      break;
    }
    case 'night_action': {
      if (s.phase !== 'NIGHT') break;
      const seat = event.seat as SeatId;
      const target = event.target as SeatId | null;
      const st = s.seats[seat];
      if (!st || !st.alive) break;
      const isKiller =
        st.faction === 'MAFIA' || st.faction === 'NEUTRAL_KILLING' || st.role === 'VIGILANTE';
      if (target === null) s.nightKills.delete(seat);
      else if (isKiller) s.nightKills.set(seat, target);
      break;
    }
    case 'day_ability': {
      const seat = event.seat as SeatId;
      const st = s.seats[seat];
      if (st && event.ability === 'reveal' && st.role === 'MAYOR') {
        st.mayorRevealed = true;
        effects.push({ to: 'public', msg: v('day_ability_ack', { ability: 'reveal' }) });
      }
      break;
    }
    case 'seat_left': {
      const seat = event.seat as SeatId;
      const st = s.seats[seat];
      if (st) st.leaving = true;
      break;
    }
    default:
      break;
  }
  return { state: s, effects };
}

function nextDeadline(state: GameState): Deadline | null {
  const s = asFallback(state);
  if (s.endsAt === null || s.over) return null;
  return { phase: s.phase, endsAt: s.endsAt };
}

// --- View helpers (used by the adapter for routing & snapshots) ------------

function seatView(st: SeatState): EngineSeatView {
  return {
    seat: st.seat,
    name: `Seat ${st.seat}`,
    role: st.role,
    faction: st.faction,
    alive: st.alive,
    revealed: st.revealed,
    connected: true,
    afk: false,
    lastWill: '',
    deathNote: '',
    mayorRevealed: st.mayorRevealed,
    // The fallback engine does not track death timing; points scaling degrades
    // gracefully to null here. The real engine supplies these.
    deathDay: null,
    deathCause: null,
    stumped: false,
  };
}

export function makeFallbackEngine(): Engine {
  return {
    init,
    apply,
    nextDeadline,
    phaseInfo(state: GameState) {
      const s = asFallback(state);
      return { phase: s.phase, dayNumber: s.dayNumber, endsAt: s.endsAt };
    },
    mafiaSeats(state: GameState) {
      return asFallback(state)
        .seats.filter((x) => x.faction === 'MAFIA' && x.alive)
        .map((x) => x.seat);
    },
    triadSeats(state: GameState) {
      return asFallback(state)
        .seats.filter((x) => x.faction === 'TRIAD' && x.alive)
        .map((x) => x.seat);
    },
    deadSeats(state: GameState) {
      return asFallback(state)
        .seats.filter((x) => !x.alive)
        .map((x) => x.seat);
    },
    allSeats(state: GameState) {
      return asFallback(state).seats.map((x) => x.seat);
    },
    isOver(state: GameState) {
      return asFallback(state).over;
    },
    seats(state: GameState) {
      return asFallback(state).seats.map(seatView);
    },
    yourRole(state: GameState, seat: SeatId): Effect | null {
      const s = asFallback(state);
      const st = s.seats[seat];
      if (!st) return null;
      // Faction roster ("mates") for an informed evil faction (MAFIA or TRIAD),
      // delivered only to a seat of that same faction (mirrors the real engine).
      const mates =
        st.faction === 'MAFIA' || st.faction === 'TRIAD'
          ? s.seats.filter((x) => x.faction === st.faction && x.seat !== seat).map((x) => x.seat)
          : undefined;
      const payload: Record<string, unknown> = {
        type: 'your_role',
        role: st.role,
        faction: st.faction,
        abilities: [],
      };
      if (mates) payload.mates = mates;
      return { to: [seat], msg: { v: 1, ...payload } as unknown as ServerMessage };
    },
    abilities(_state: GameState, _seat: SeatId): AbilityInfo[] {
      return [];
    },
    nightAbilityFor(role: RoleId): string | null {
      const f = ROLES[role];
      if (!f) return null;
      return f.nightAction === 'none' ? null : 'act';
    },
    gameOver(state: GameState) {
      const s = asFallback(state);
      if (!s.over) return null;
      return {
        winners: [],
        results: s.seats.map((x) => ({
          seat: x.seat,
          role: x.role,
          faction: x.faction,
          outcome: 'loss',
        })),
      };
    },
    // TEST MODE god-view (best-effort: the fallback tracks a simplified subset of
    // §6 state, so intents/marks/traces are approximate). The real engine
    // (@nocturne/engine) supplies the authoritative view.
    debugView(state: GameState) {
      const s = asFallback(state);
      return {
        phase: s.phase,
        dayNumber: s.dayNumber,
        nightNumber: s.dayNumber,
        seats: s.seats.map((x) => ({
          seat: x.seat,
          name: `Seat ${x.seat}`,
          role: x.role,
          faction: x.faction,
          alive: x.alive,
          revealed: x.revealed,
          usesRemaining: null,
          selfUsesRemaining: null,
          nightImmune: x.role === 'GODFATHER' || x.faction === 'NEUTRAL_KILLING',
          mayorRevealed: x.mayorRevealed,
          exeTarget: null,
          leaving: x.leaving,
          connected: true,
          afk: false,
        })),
        mafiaRoster: s.seats.filter((x) => x.faction === 'MAFIA').map((x) => x.seat),
        intents: [...s.nightKills].map(([seat, target]) => ({ seat, ability: 'kill', target })),
        jailTarget: null,
        pendingJesterGrief: null,
        voteTallies: (() => {
          const m = new Map<SeatId, number>();
          for (const [voter, target] of s.votes) {
            if (target === 'skip') continue;
            const w = voteWeight(s.seats[voter] as SeatState);
            m.set(target, (m.get(target) ?? 0) + w);
          }
          return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([seat, weight]) => ({ seat, weight }));
        })(),
        votesBySeat: [...s.votes].map(([seat, target]) => ({ seat, target })),
        trial:
          s.accused !== null
            ? {
                accused: s.accused,
                verdicts: [...s.verdicts].map(([seat, value]) => ({ seat, value })),
              }
            : null,
        executionerTargets: [],
      };
    },
    debugTraces(_state: GameState) {
      // The fallback engine does not produce structured ResolutionTraces.
      return [];
    },
    traceCount(_state: GameState) {
      return 0;
    },
  };
}

/** Test/room helper: read seats from a fallback state (typed). */
export function fallbackSeats(state: GameState): {
  seat: SeatId;
  role: RoleId;
  faction: Faction;
  alive: boolean;
}[] {
  return asFallback(state).seats.map((x) => ({
    seat: x.seat,
    role: x.role,
    faction: x.faction,
    alive: x.alive,
  }));
}

/** Test/room helper: set the resolved config on a fresh state. */
export function fallbackSetConfig(state: GameState, config: ResolvedLobbyConfig): void {
  asFallback(state).config = config;
}
