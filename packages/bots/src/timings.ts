/**
 * Phase timings for simulated games (BUILD_SPEC §6.2, §12.2).
 *
 * The server has NO injectable clock/timescale seam reachable from outside the
 * server package: LobbyManager.startGame constructs `new Room(...)` without the
 * Room's optional `schedule`/`clock` params, so the Room always uses real
 * setTimeout driven by engine `phaseEndsAt` (= ts + config-seconds). The ONLY
 * legitimate acceleration lever for socket games is therefore the lobby config
 * timings, clamped to the §6.2 minimum bounds. We use them. DAWN (8s + 4s/death)
 * and EXECUTION (12s) are fixed and cannot be reduced — that is why a full socket
 * game still takes tens of seconds, and why bulk determinism/leak sweeps use the
 * engine-level fast simulator instead (see DECISIONS.md, §12.2 FAST path).
 */

import { type PhaseTimings } from '@nocturne/shared';

export type SimTimings = PhaseTimings;

/** The fastest LEGAL timings — every phase pinned to its §6.2 minimum. */
export const FAST_TIMINGS: SimTimings = {
  DAY_0: 15,
  NIGHT: 30,
  DAY_DISCUSSION: 0,
  DAY_VOTING: 60,
  TRIAL_DEFENSE: 15,
  TRIAL_JUDGMENT: 15,
};
