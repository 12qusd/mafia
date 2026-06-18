import { z } from 'zod';

/**
 * Death causes (BUILD_SPEC §6.8 kill sources + §3/§8 day & leaver deaths).
 *
 * Used in `death_announce.cause` and persisted in the resolution trace. These
 * are mechanical labels; the player-facing announcement wording lives in
 * `strings.ts`.
 *
 * - mafia          — the Mafia faction kill.
 * - triad          — the Triad faction kill (the Mafia kill's mirror for the
 *                    second evil faction). A basic attack, identical mechanics:
 *                    stopped by Doctor/Bodyguard/vest/jail/night-immunity.
 * - serial_killer  — a Serial Killer night kill.
 * - vigilante      — a Vigilante shot.
 * - jailor_execute — a Jailor execution (pierces immunity and heals).
 * - jester_grief   — a guilty-voter taken the night after a Jester lynch.
 * - lynch          — day-time execution after trial.
 * - leave          — explicit "leave game" suicide at night resolution (§8).
 * - bodyguard      — a Bodyguard's counterattack on a ward's assailant (batch A).
 * - veteran        — a Veteran on alert killing a seat that visited them (batch A).
 * - arsonist       — an Arsonist ignition burning a doused seat (batch B). A
 *                    powerful attack: pierces basic defense (heal/guard/vest) but
 *                    is stopped by jail and night-immunity.
 * - crusader       — a Crusader striking down a visitor to its ward (batch C). A
 *                    Town-aligned basic attack (stopped by night-immunity/vest,
 *                    interceptable by a Bodyguard).
 * - ambush         — an Ambusher killing a visitor to the house it staked out
 *                    (batch C). A Mafia-aligned basic attack.
 * - werewolf       — a Werewolf's full-moon rampage (batch D). A powerful attack:
 *                    pierces basic defense (heal/guard/vest) but is stopped by jail
 *                    and night-immunity. Kills the chosen victim AND every seat that
 *                    visited the Werewolf that night.
 * - massacre       — a Mass Murderer's slaughter at a chosen house (batch D). A
 *                    powerful attack like the werewolf rampage; kills the resident
 *                    and every OTHER visitor to that house.
 * - juggernaut     — a Juggernaut kill (batch D). A neutral-killing attack that is
 *                    basic at first and becomes powerful (piercing, with a rampage
 *                    on visitors) once the Juggernaut has enough kills.
 */
export const DEATH_CAUSES = [
  'mafia',
  'triad',
  'serial_killer',
  'vigilante',
  'jailor_execute',
  'jester_grief',
  'lynch',
  'leave',
  'admin',
  'bodyguard',
  'veteran',
  'arsonist',
  'crusader',
  'ambush',
  'werewolf',
  'massacre',
  'juggernaut',
] as const;

export const DeathCauseSchema = z.enum(DEATH_CAUSES);

/** Why a seat died. */
export type DeathCause = z.infer<typeof DeathCauseSchema>;
