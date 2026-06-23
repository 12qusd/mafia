/**
 * @nocturne/engine — pure, deterministic game engine (BUILD_SPEC §6).
 *
 * Public API (§6):
 *   - init(setup, seed)        → GameState
 *   - apply(state, event)      → { state, effects }
 *   - nextDeadline(state)      → { phase, endsAt } | null
 *
 * Zero I/O. No Date.now, no Math.random — the only randomness flows from one
 * seeded PRNG carried in GameState. Same (setup, seed, ordered event log) ⇒
 * byte-identical states.
 */

import type { Phase, GameTick } from '@nocturne/shared';
import type { GameState } from './state.js';

export { init, type InitOptions, type SeatPreference } from './init.js';
export { apply, type ApplyResult } from './apply.js';

export type { GameState, SeatState, ResolutionTrace, NightAbility, GameOverState, SeatResult, WinCheckReason } from './state.js';
export type { GameEvent } from './events.js';

export { roleToNightAbility, yourRoleEffect, abilityInfoFor } from './roleinfo.js';
export { hashState } from './hash.js';

// Read-only god-view extractor for TEST MODE (pure; no game logic).
export { debugView, debugTraces, traceCount, type DebugView, type DebugSeatView } from './debug.js';

// PRNG is exported for testing / tooling determinism checks.
export { seedPrng, nextFloat, nextInt } from './prng.js';

/**
 * The next phase deadline the server should schedule (BUILD_SPEC §6). Returns
 * the current phase and its end tick, or null if the current phase has no
 * deadline (DAWN with no remaining time, GAME_OVER, etc.).
 */
export function nextDeadline(state: GameState): { phase: Phase; endsAt: GameTick } | null {
  if (state.gameOver) return null;
  if (state.phaseEndsAt === null) return null;
  return { phase: state.phase, endsAt: state.phaseEndsAt };
}
