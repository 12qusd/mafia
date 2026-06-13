/**
 * Read-only god-view extractor for TEST MODE (NOCTURNE test mode).
 *
 * PURE, read-only: derives the full debug snapshot from an existing
 * {@link GameState} without mutating it. The server's god-view path calls this
 * to compose `debug_state` frames for the test-lobby host audience. It exposes
 * only data already present in engine state (§6 keeps the complete GameState,
 * night intents, marks, traces) — no new game logic.
 */

import type { SeatId, Phase, RoleId, Faction, DeathCause, VerdictValue } from '@nocturne/shared';
import type { GameState, SeatState } from './state.js';

/** One seat's complete (normally-secret) live state. */
export interface DebugSeatView {
  seat: SeatId;
  name: string;
  role: RoleId;
  faction: Faction;
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
}

export interface DebugView {
  phase: Phase;
  dayNumber: number;
  nightNumber: number;
  seats: DebugSeatView[];
  mafiaRoster: SeatId[];
  intents: { seat: SeatId; ability: string; target: SeatId | null }[];
  jailTarget: SeatId | null;
  pendingJesterGrief: SeatId[] | null;
  voteTallies: { seat: SeatId; weight: number }[];
  votesBySeat: { seat: SeatId; target: SeatId | 'skip' }[];
  trial: { accused: SeatId; verdicts: { seat: SeatId; value: VerdictValue }[] } | null;
  executionerTargets: { seat: SeatId; target: SeatId }[];
}

/** Roles night-immune by their own flag (mirrors resolve.ts `isNightImmune`). */
function nightImmuneByRole(s: SeatState): boolean {
  return s.role === 'GODFATHER' || s.role === 'SERIAL_KILLER' || s.role === 'EXECUTIONER';
}

/** Compute open-vote tallies (mirrors apply.ts `computeTallies`, read-only). */
function tallies(state: GameState): { seat: SeatId; weight: number }[] {
  const m = new Map<SeatId, number>();
  for (const v of state.nomination.votes) {
    if (v.target === 'skip') continue;
    const voter = state.seats[v.seat];
    const w = voter?.mayorRevealed ? 3 : 1;
    m.set(v.target, (m.get(v.target) ?? 0) + w);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([seat, weight]) => ({ seat, weight }));
}

/** Build the read-only god view from engine state. Does not mutate `state`. */
export function debugView(state: GameState): DebugView {
  return {
    phase: state.phase,
    dayNumber: state.dayNumber,
    nightNumber: state.nightNumber,
    seats: state.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      role: s.role,
      faction: s.faction,
      alive: s.alive,
      revealed: s.revealed,
      usesRemaining: s.usesRemaining,
      selfUsesRemaining: s.selfUsesRemaining,
      nightImmune: nightImmuneByRole(s),
      mayorRevealed: s.mayorRevealed,
      exeTarget: s.exeTarget,
      leaving: s.leaving,
      connected: s.connected,
      afk: s.afk,
    })),
    mafiaRoster: state.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat),
    intents: state.nightIntents.map((i) => ({ seat: i.seat, ability: i.ability, target: i.target })),
    jailTarget: state.jailTarget,
    pendingJesterGrief: state.pendingJesterGrief ? [...state.pendingJesterGrief.guiltyVoters] : null,
    voteTallies: tallies(state),
    votesBySeat: state.nomination.votes.map((v) => ({ seat: v.seat, target: v.target })),
    trial: state.trial
      ? {
          accused: state.trial.accused,
          verdicts: state.trial.verdicts.map((v) => ({ seat: v.seat, value: v.value })),
        }
      : null,
    executionerTargets: state.seats
      .filter((s): s is SeatState & { exeTarget: SeatId } => s.role === 'EXECUTIONER' && s.exeTarget !== null)
      .map((s) => ({ seat: s.seat, target: s.exeTarget })),
  };
}

/** Read the full accumulated resolution trace array (defensive copy). */
export function debugTraces(state: GameState): GameState['traces'] {
  return state.traces.slice();
}

/** Count of accumulated traces (server diffs this across a night resolution). */
export function traceCount(state: GameState): number {
  return state.traces.length;
}

/** The death cause type, re-exported for the server's debug_trace payload. */
export type { DeathCause };
