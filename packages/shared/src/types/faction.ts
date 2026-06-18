import { z } from 'zod';

/**
 * Factions (BUILD_SPEC §1.1, §6.5).
 *
 * - TOWN — uninformed majority; wins by eliminating all evil players.
 * - MAFIA — informed minority with private night chat; wins at parity.
 * - TRIAD — a SECOND informed evil killing faction, structurally identical to
 *   the Mafia (its own private night chat, its own faction kill, its own parity
 *   win). Mafia and Triad are independent enemies: two evil factions cannot
 *   co-win — they must wipe each other out first (§6.9, see wincheck.ts).
 * - NEUTRAL_KILLING — independent killer (Serial Killer); wins as last killer.
 * - NEUTRAL_BENIGN — independent personal win conditions (Jester, Executioner,
 *   Survivor); do not threaten the town/mafia parity math directly.
 */
export const FACTIONS = ['TOWN', 'MAFIA', 'TRIAD', 'NEUTRAL_KILLING', 'NEUTRAL_BENIGN'] as const;

export const FactionSchema = z.enum(FACTIONS);

/** A role's faction. */
export type Faction = z.infer<typeof FactionSchema>;
