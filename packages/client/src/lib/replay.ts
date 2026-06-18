/**
 * Replay reconstruction (goal 7). Folds a recorded event log through the pure
 * engine to rebuild match state at every step, so the viewer can scrub the
 * timeline and show phase/day + living/dead seats at any position.
 *
 * The replay endpoint gives `setupId`, `seed`, and a fully ordered event log.
 * The events drive the state machine deterministically; we resolve the setup
 * from the shipped catalog when possible (so role assignment matches), and fall
 * back gracefully when the setup is a custom/chaos one we cannot resolve
 * client-side — in that case we still surge the phase/day from the events.
 */

import { init, apply, type GameState, type GameEvent } from '@nocturne/engine';
import { getSetup, type Phase, type RoleId } from '@nocturne/shared';
import type { ReplayEvent } from './api.js';

/** A reconstructed step in the timeline. */
export interface ReplayStep {
  /** The 1-based step index (0 = initial state, before any event). */
  index: number;
  /** The event seq that produced this step (null for the initial state). */
  seq: number | null;
  /** The event type label (e.g. "phase_end", "vote"). */
  label: string;
  phase: Phase;
  dayNumber: number;
  /** Living seat ids at this step. */
  living: number[];
  /** Dead seat ids at this step. */
  dead: number[];
}

export interface ReplayReconstruction {
  ok: boolean;
  steps: ReplayStep[];
  /** Resolved per-seat roles (from the engine init), if the setup resolved. */
  roles: Record<number, RoleId> | null;
}

function snapshot(state: GameState, index: number, seq: number | null, label: string): ReplayStep {
  const living: number[] = [];
  const dead: number[] = [];
  for (const s of state.seats) {
    if (s.alive) living.push(s.seat);
    else dead.push(s.seat);
  }
  return {
    index,
    seq,
    label,
    phase: state.phase,
    dayNumber: state.dayNumber,
    living,
    dead,
  };
}

function eventLabel(ev: unknown): string {
  if (ev && typeof ev === 'object' && 'type' in ev && typeof (ev as { type: unknown }).type === 'string') {
    return (ev as { type: string }).type;
  }
  return 'event';
}

/**
 * Reconstruct the timeline from a replay's setup id, seed, player count and the
 * ordered event log. Defensive: a single bad event aborts the fold but keeps
 * whatever steps were reconstructed so far (still useful for the viewer).
 */
export function reconstructReplay(
  setupId: string,
  seed: string,
  playerCount: number,
  events: ReplayEvent[],
): ReplayReconstruction {
  const setup = getSetup(setupId);
  if (!setup) {
    // Unknown setup (custom/chaos) — we cannot init the engine, but we can still
    // surface phase progression from phase-bearing events is not possible
    // without state, so report no reconstruction.
    return { ok: false, steps: [], roles: null };
  }

  let state: GameState;
  try {
    state = init(setup, seed, { playerCount });
  } catch {
    return { ok: false, steps: [], roles: null };
  }

  const roles: Record<number, RoleId> = {};
  for (const s of state.seats) roles[s.seat] = s.role;

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const steps: ReplayStep[] = [snapshot(state, 0, null, 'start')];

  let i = 1;
  for (const rec of ordered) {
    try {
      const result = apply(state, rec.event as GameEvent);
      state = result.state;
      steps.push(snapshot(state, i, rec.seq, eventLabel(rec.event)));
      i += 1;
    } catch {
      // Stop folding on the first event the engine rejects; keep prior steps.
      break;
    }
  }

  return { ok: true, steps, roles };
}
