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
 * - VAMPIRE — a THIRD evil killing faction that grows by CONVERSION rather than
 *   by a faction kill. Each night a vampire bites a victim; a successful bite
 *   turns a Town/Neutral-Benign seat into a new Vampire (role + faction change).
 *   Vampires win on parity exactly like the Mafia/Triad, but — by design — they
 *   share NO secret chat and NO roster: each vampire acts independently and is
 *   never told who the others are (knowledge-isolated, so the conversion is
 *   trivially leak-safe; see DECISIONS.md "Vampire conversion faction"). Like the
 *   Mafia and Triad, the Vampires are enemies of every other killing faction:
 *   they cannot co-win, they must wipe the others out first (§6.9, wincheck.ts).
 * - NEUTRAL_KILLING — independent killer (Serial Killer); wins as last killer.
 * - NEUTRAL_BENIGN — independent personal win conditions (Jester, Executioner,
 *   Survivor); do not threaten the town/mafia parity math directly.
 */
export const FACTIONS = [
  'TOWN',
  'MAFIA',
  'TRIAD',
  'VAMPIRE',
  'NEUTRAL_KILLING',
  'NEUTRAL_BENIGN',
] as const;

export const FactionSchema = z.enum(FACTIONS);

/** A role's faction. */
export type Faction = z.infer<typeof FactionSchema>;
