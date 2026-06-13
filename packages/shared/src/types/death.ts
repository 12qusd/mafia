import { z } from 'zod';

/**
 * Death causes (BUILD_SPEC §6.8 kill sources + §3/§8 day & leaver deaths).
 *
 * Used in `death_announce.cause` and persisted in the resolution trace. These
 * are mechanical labels; the player-facing announcement wording lives in
 * `strings.ts`.
 *
 * - mafia          — the Mafia faction kill.
 * - serial_killer  — a Serial Killer night kill.
 * - vigilante      — a Vigilante shot.
 * - jailor_execute — a Jailor execution (pierces immunity and heals).
 * - jester_grief   — a guilty-voter taken the night after a Jester lynch.
 * - lynch          — day-time execution after trial.
 * - leave          — explicit "leave game" suicide at night resolution (§8).
 */
export const DEATH_CAUSES = [
  'mafia',
  'serial_killer',
  'vigilante',
  'jailor_execute',
  'jester_grief',
  'lynch',
  'leave',
] as const;

export const DeathCauseSchema = z.enum(DEATH_CAUSES);

/** Why a seat died. */
export type DeathCause = z.infer<typeof DeathCauseSchema>;
