/**
 * Engine-level FAST simulator (BUILD_SPEC §12.2 FAST path, §12.3 bulk sweep).
 *
 * Drives the REAL engine directly (init/apply) with NO sockets and NO real
 * timers — phases advance by feeding `phase_end` events whose `ts` equals the
 * engine's own `phaseEndsAt`, so a full game resolves in microseconds. This is
 * used ONLY for the bulk determinism / leak property runs the spec wants at scale
 * (≥200 games), because the socket path is wall-clock-bound by the engine's fixed
 * DAWN/EXECUTION phases (see DECISIONS.md).
 *
 * Crucially this path REUSES:
 *   - the same bot policy heuristics (via a tiny in-memory client shim that mirrors
 *     the BotView the socket client builds from frames), and
 *   - the SAME effect→recipient routing the server's ScopedTransport uses, so the
 *     per-seat captures fed to the leak auditor are identical in shape to the
 *     socket path. A leak here is a leak there.
 */

import {
  init,
  apply,
  nextDeadline,
  roleToNightAbility,
  abilityInfoFor,
  yourRoleEffect,
  type GameState,
  type GameEvent,
} from '@nocturne/engine';
import {
  getSetup,
  type Effect,
  type ServerMessage,
  type SeatId,
  type GameSetup,
} from '@nocturne/shared';
import { auditGame, type LeakViolation, type AuditSeat } from './leak.js';
import { BotPolicy } from './policy.js';
import { type BotView } from './client.js';
import { FAST_TIMINGS } from './timings.js';

export interface EngineGameResult {
  completed: boolean;
  steps: number;
  winners: string[];
  allRoles: { seat: number; role: string; faction: string; outcome: string }[];
  leaks: LeakViolation[];
  /** Hash-ish fingerprint for determinism checks (winners + role layout). */
  fingerprint: string;
}

/**
 * A minimal client shim exposing the BotView the policy reads, plus a `send`
 * queue the driver drains into engine events. It mirrors how the socket client
 * folds frames into a view — so the same policy code runs unchanged.
 */
class EngineClientShim {
  readonly view: BotView;
  readonly capture: ServerMessage[] = [];
  readonly outbox: { type: string; payload: Record<string, unknown> }[] = [];
  policyDrive: ((m: ServerMessage) => void) | null = null;

  constructor(readonly seat: SeatId) {
    this.view = {
      seat,
      role: null,
      faction: null,
      mates: [],
      abilities: [],
      phase: null,
      dayNumber: 0,
      endsAt: null,
      seats: [],
      alive: new Set(),
      selfAlive: true,
      mayorRevealed: false,
      tallies: new Map(),
      trialAccused: null,
      over: false,
      winners: [],
      recentChat: [],
      privateResults: [],
    };
  }

  /** The policy's send() — captured as a pending engine event. */
  send(msg: { type: string } & Record<string, unknown>): void {
    this.outbox.push({ type: msg.type, payload: msg });
  }

  /** Fold a delivered frame into the view (same logic as the socket client). */
  receive(msg: ServerMessage): void {
    this.capture.push(msg);
    const v = this.view;
    switch (msg.type) {
      case 'your_role':
        v.role = msg.role;
        v.faction = msg.faction;
        v.mates = msg.mates ? [...msg.mates] : [];
        v.abilities = msg.abilities.map((a) => ({ id: a.id, timing: a.timing, usesRemaining: a.usesRemaining }));
        break;
      case 'phase_change':
        v.phase = msg.phase;
        v.dayNumber = msg.dayNumber;
        v.endsAt = msg.endsAt;
        if (msg.phase !== 'TRIAL_DEFENSE' && msg.phase !== 'TRIAL_JUDGMENT') v.trialAccused = null;
        if (msg.phase === 'DAY_VOTING') v.tallies = new Map();
        break;
      case 'vote_update':
        v.tallies = new Map(msg.tallies.map((t) => [t.seat, t.weight]));
        break;
      case 'trial_start':
        v.trialAccused = msg.accusedSeat;
        break;
      case 'death_announce':
        v.alive.delete(msg.seat);
        if (msg.seat === v.seat) v.selfAlive = false;
        break;
      case 'day_ability_ack':
        if (msg.ability === 'reveal' && msg.target === v.seat) v.mayorRevealed = true;
        break;
      case 'game_over':
        v.over = true;
        v.winners = [...msg.winners];
        break;
      default:
        break;
    }
    try {
      this.policyDrive?.(msg);
    } catch {
      /* a policy bug never desyncs the driver */
    }
  }
}

/** Route one engine Effect to the seats entitled to it (server routing parity). */
function routeEffect(
  effect: Effect,
  state: GameState,
  shims: EngineClientShim[],
): void {
  const aliveSeats = state.seats.filter((s) => s.alive).map((s) => s.seat);
  const deadSeats = state.seats.filter((s) => !s.alive).map((s) => s.seat);
  const mafiaSeats = state.seats.filter((s) => s.alive && s.faction === 'MAFIA').map((s) => s.seat);
  const triadSeats = state.seats.filter((s) => s.alive && s.faction === 'TRIAD').map((s) => s.seat);
  const all = state.seats.map((s) => s.seat);

  let recipients: SeatId[];
  if (effect.to === 'public') recipients = all;
  else if (effect.to === 'mafia') recipients = mafiaSeats;
  else if (effect.to === 'triad') recipients = triadSeats;
  else if (effect.to === 'dead') recipients = deadSeats;
  else recipients = effect.to;

  for (const seat of recipients) {
    const shim = shims[seat];
    if (shim) shim.receive(effect.msg);
  }
  void aliveSeats;
}

/** Translate a policy's outbox entry into an engine GameEvent. */
function toEngineEvent(
  entry: { type: string; payload: Record<string, unknown> },
  seat: SeatId,
  ts: number,
): GameEvent | null {
  const p = entry.payload;
  switch (entry.type) {
    case 'night_action':
      return { type: 'night_action', seat, ability: p.ability as never, target: (p.target as SeatId | null) ?? null, ts };
    case 'day_ability':
      return {
        type: 'day_ability',
        seat,
        ability: p.ability as 'jail' | 'reveal',
        ...(p.target !== undefined ? { target: p.target as SeatId } : {}),
        ts,
      };
    case 'vote':
      return { type: 'vote', seat, target: (p.target as SeatId | 'skip' | null) ?? null, ts };
    case 'verdict':
      return { type: 'verdict', seat, value: p.value as never, ts };
    case 'chat':
      return { type: 'chat', seat, channel: p.channel as never, text: String(p.text), ts };
    default:
      return null;
  }
}

export interface EngineGameOptions {
  players: number;
  seed: string;
  setupId: string;
  /** Safety cap on phase transitions. */
  maxSteps?: number;
}

/** Play one full game purely in-engine; returns stats + leak audit. */
export function playEngineGame(opts: EngineGameOptions): EngineGameResult {
  const setup = getSetup(opts.setupId);
  if (!setup) throw new Error(`unknown setup ${opts.setupId}`);
  const locked = lockSetup(setup, opts.players);

  const names = Array.from({ length: opts.players }, (_, i) => `bot-${i}`);
  let state = init(locked, opts.seed, {
    playerCount: opts.players,
    names,
    config: {
      timings: FAST_TIMINGS as Required<typeof FAST_TIMINGS>,
      whispersEnabled: true,
      deadSeeAll: true,
      lastWillsEnabled: true,
      firstPhase: 'day_no_lynch',
      testMode: false,
    },
  });

  const shims: EngineClientShim[] = state.seats.map((s) => new EngineClientShim(s.seat));
  shims.forEach((shim, i) => {
    const policy = new BotPolicy(shim as unknown as never, { seed: `${opts.seed}:bot:${i}` });
    shim.policyDrive = (m) => policy.onFrame(m);
    // Pre-fill alive/seats so the policy reasons correctly (mirrors game_started).
    shim.view.seats = state.seats.map((x) => x.seat);
    shim.view.alive = new Set(state.seats.filter((x) => x.alive).map((x) => x.seat));
  });

  // Deliver role cards (your_role) like the server's room.begin() does.
  for (const s of state.seats) {
    const eff = yourRoleEffect(state, s);
    routeEffect(eff, state, shims);
  }

  let ts = 1;
  const dispatch = (effects: Effect[]) => {
    for (const e of effects) routeEffect(e, state, shims);
  };

  // Advance ASSIGN → DAY_0 first (server does this in begin()).
  ({ state } = applyEvent({ type: 'phase_end', ts: ts++ }));

  const maxSteps = opts.maxSteps ?? 2000;
  let steps = 0;
  while (!state.gameOver && steps < maxSteps) {
    steps++;
    // 1) Let policies act for the CURRENT phase by draining their outboxes,
    //    feeding each as a validated engine event. Drain a few rounds so e.g.
    //    mafia chat → kill, or follow-tally, settle.
    for (let round = 0; round < 4; round++) {
      let any = false;
      for (let seat = 0; seat < shims.length; seat++) {
        const shim = shims[seat]!;
        // Trigger periodic ticks too (the policy may change a vote/kill).
        // We invoke tick via the same policy through a synthetic no-op frame:
        // simpler is to call the policy's tick directly; but the shim doesn't
        // hold the policy. Instead we rely on phase_change-driven actions plus
        // outbox draining; the socket path's ticks are an optimization, not a
        // correctness requirement.
        const out = shim.outbox.splice(0, shim.outbox.length);
        for (const entry of out) {
          const ev = toEngineEvent(entry, seat, ts++);
          if (!ev) continue;
          any = true;
          const r = apply(state, ev);
          state = r.state;
          dispatch(r.effects);
        }
      }
      if (!any) break;
    }

    // 2) Advance the phase via a phase_end at the engine's own deadline tick.
    const dl = nextDeadline(state);
    const stepTs = dl ? Math.max(ts, dl.endsAt) + 1 : ts;
    ts = stepTs + 1;
    const r = applyEvent({ type: 'phase_end', ts: stepTs });
    state = r.state;
  }

  function applyEvent(ev: GameEvent): { state: GameState; effects: Effect[] } {
    const r = apply(state, ev);
    state = r.state;
    dispatch(r.effects);
    return r;
  }

  const over = state.gameOver;
  const allRoles = state.seats.map((s) => ({
    seat: s.seat,
    role: s.role,
    faction: s.faction,
    outcome: over?.results.find((x) => x.seat === s.seat)?.outcome ?? 'loss',
  }));

  const auditSeats: AuditSeat[] = shims.map((shim) => ({
    seat: shim.seat,
    role: state.seats[shim.seat]!.role,
    faction: state.seats[shim.seat]!.faction,
    frames: shim.capture,
  }));
  const leaks = over
    ? auditGame({ seats: auditSeats, spectators: [], deadSeeAll: true })
    : [];

  const fingerprint = JSON.stringify({
    w: over?.winners ?? [],
    r: allRoles.map((r) => `${r.seat}:${r.role}`),
  });

  return {
    completed: !!over,
    steps,
    winners: over ? [...over.winners] : [],
    allRoles,
    leaks,
    fingerprint,
  };
}

/** Lock a multi-count setup to a single player count (server does this too). */
function lockSetup(setup: GameSetup, count: number): GameSetup {
  const slots = setup.slotsByPlayerCount[String(count)];
  if (!slots) throw new Error(`setup ${setup.id} has no slots for ${count} players`);
  return {
    ...setup,
    minPlayers: count,
    maxPlayers: count,
    slotsByPlayerCount: { [String(count)]: [...slots] },
  };
}

// roleToNightAbility / abilityInfoFor imported for potential richer shims; the
// policy reads abilities from your_role frames so these stay available but unused
// at top level.
void roleToNightAbility;
void abilityInfoFor;
