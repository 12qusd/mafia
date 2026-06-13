/** Map a game phase to a CSS scene tint (BUILD_SPEC §13.2 day/night ambiance). */

import type { Phase } from '@nocturne/shared';

export type Scene = 'neutral' | 'day' | 'dusk' | 'night';

export function sceneForPhase(phase: Phase | null): Scene {
  switch (phase) {
    case 'NIGHT':
      return 'night';
    case 'DAWN':
    case 'DAY_0':
    case 'DAY_DISCUSSION':
    case 'DAY_VOTING':
      return 'day';
    case 'TRIAL_DEFENSE':
    case 'TRIAL_JUDGMENT':
    case 'EXECUTION':
      return 'dusk';
    default:
      return 'neutral';
  }
}
