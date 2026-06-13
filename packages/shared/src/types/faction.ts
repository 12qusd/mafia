import { z } from 'zod';

/**
 * Factions (BUILD_SPEC §1.1, §6.5).
 *
 * - TOWN — uninformed majority; wins by eliminating all evil players.
 * - MAFIA — informed minority with private night chat; wins at parity.
 * - NEUTRAL_KILLING — independent killer (Serial Killer); wins as last killer.
 * - NEUTRAL_BENIGN — independent personal win conditions (Jester, Executioner,
 *   Survivor); do not threaten the town/mafia parity math directly.
 */
export const FACTIONS = ['TOWN', 'MAFIA', 'NEUTRAL_KILLING', 'NEUTRAL_BENIGN'] as const;

export const FactionSchema = z.enum(FACTIONS);

/** A role's faction. */
export type Faction = z.infer<typeof FactionSchema>;
