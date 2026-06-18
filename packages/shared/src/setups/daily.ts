/**
 * PURE setup-of-the-day rotation.
 *
 * Deterministically rotates among the shipped {@link SETUPS} by calendar date,
 * and derives a per-day chaos seed. No clock here — the SERVER passes the date
 * string (`YYYY-MM-DD`); `shared` only hashes it. Same date ⇒ same feature.
 */

import type { GameSetup } from '../types/setup.js';
import { CLASSIC_NOCTURNE } from './classic.js';
import { CROSS_EXAMINATION, GUNSMOKE, SMOKE_AND_MIRRORS } from './curated.js';
import { seedPrng } from './prng.js';

/** The shipped setups, in stable rotation order (mirrors SETUPS in index). */
const SHIPPED: readonly GameSetup[] = [
  CLASSIC_NOCTURNE,
  CROSS_EXAMINATION,
  GUNSMOKE,
  SMOKE_AND_MIRRORS,
];

/** Hash a `YYYY-MM-DD` string and rotate it into the shipped setup list. */
export function dailySetupId(dateISO: string): string {
  const day = dateISO.slice(0, 10);
  const idx = seedPrng(day) % SHIPPED.length;
  // SHIPPED is non-empty (the three shipped setups); index is in range.
  return (SHIPPED[idx] as GameSetup).id;
}

/** The chaos seed featured for a given day (date-derived, stable). */
export function dailyChaosSeed(dateISO: string): string {
  return `daily-${dateISO.slice(0, 10)}`;
}

/**
 * The full daily feature: the rotated shipped setup id plus a date-derived chaos
 * seed (build the previewable setup with `chaosSetup(seed)`).
 */
export function dailyFeature(dateISO: string): { setupId: string; chaosSeed: string } {
  return { setupId: dailySetupId(dateISO), chaosSeed: dailyChaosSeed(dateISO) };
}
