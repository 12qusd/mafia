import type { GameSetup } from '../types/setup.js';
import { CLASSIC_NOCTURNE } from './classic.js';
import { CROSS_EXAMINATION, GUNSMOKE, SMOKE_AND_MIRRORS } from './curated.js';

export { CLASSIC_NOCTURNE } from './classic.js';
export { CROSS_EXAMINATION, GUNSMOKE, SMOKE_AND_MIRRORS } from './curated.js';
export { slotFaction, factionCounts, factionCountsAt, slotCountAt } from './compose.js';
export { validateSetup, type ValidationResult } from './validate.js';
export { chaosSetup } from './chaos.js';
export { dailySetupId, dailyChaosSeed, dailyFeature } from './daily.js';

/** The shipped curated setups (BUILD_SPEC §1.3, §6.10; + batch-A showcase). */
export const SETUPS: readonly GameSetup[] = [
  CLASSIC_NOCTURNE,
  CROSS_EXAMINATION,
  GUNSMOKE,
  SMOKE_AND_MIRRORS,
];

/** Setups keyed by id. */
export const SETUPS_BY_ID: Readonly<Record<string, GameSetup>> = Object.fromEntries(
  SETUPS.map((s) => [s.id, s]),
);

/** Look up a setup by id, or undefined if unknown. */
export function getSetup(id: string): GameSetup | undefined {
  return SETUPS_BY_ID[id];
}
