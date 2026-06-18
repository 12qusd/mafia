import type { GameSetup, SetupSlot } from '../types/setup.js';
import type { Faction } from '../types/faction.js';
import { ROLES } from '../roles/index.js';

/**
 * Pure helpers for reasoning about a setup's faction composition (BUILD_SPEC
 * §6.10). These do not assign roles (that needs the match PRNG in the engine);
 * they only compute the *fixed* faction each slot contributes.
 *
 * This is sound because every category pool is faction-homogeneous:
 * `RANDOM_TOWN` always yields a Town role, `RANDOM_MAFIA` always a Mafia role,
 * and `RANDOM_TRIAD` always a Triad role. The faction count of a setup is
 * therefore determined statically.
 */

/** The faction a slot is guaranteed to contribute, independent of the draw. */
export function slotFaction(slot: SetupSlot): Faction {
  if (slot.kind === 'fixed') {
    return ROLES[slot.role].faction;
  }
  switch (slot.category) {
    case 'RANDOM_TOWN':
      return 'TOWN';
    case 'RANDOM_MAFIA':
      return 'MAFIA';
    case 'RANDOM_TRIAD':
      return 'TRIAD';
  }
}

/** Faction counts for a given slot list. */
export function factionCounts(slots: readonly SetupSlot[]): Record<Faction, number> {
  const counts: Record<Faction, number> = {
    TOWN: 0,
    MAFIA: 0,
    TRIAD: 0,
    NEUTRAL_KILLING: 0,
    NEUTRAL_BENIGN: 0,
  };
  for (const slot of slots) {
    counts[slotFaction(slot)] += 1;
  }
  return counts;
}

/** Faction counts for a setup at a specific player count, or undefined. */
export function factionCountsAt(
  setup: GameSetup,
  playerCount: number,
): Record<Faction, number> | undefined {
  const slots = setup.slotsByPlayerCount[String(playerCount)];
  return slots ? factionCounts(slots) : undefined;
}

/** Total slot count for a setup at a player count (should equal playerCount). */
export function slotCountAt(setup: GameSetup, playerCount: number): number | undefined {
  return setup.slotsByPlayerCount[String(playerCount)]?.length;
}
