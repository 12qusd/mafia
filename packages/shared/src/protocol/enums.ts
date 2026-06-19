import { z } from 'zod';

/**
 * Protocol-level enums (BUILD_SPEC §9, §11).
 */

/** Report categories (BUILD_SPEC §11.1). */
export const REPORT_CATEGORIES = [
  'harassment',
  'hate',
  'spam',
  'gamethrowing',
  'cheating',
] as const;
export const ReportCategorySchema = z.enum(REPORT_CATEGORIES);
export type ReportCategory = z.infer<typeof ReportCategorySchema>;

/** Trial judgment verdict values (BUILD_SPEC §6.3, §9.1 `verdict`). */
export const VERDICT_VALUES = ['guilty', 'innocent', 'abstain'] as const;
export const VerdictValueSchema = z.enum(VERDICT_VALUES);
export type VerdictValue = z.infer<typeof VerdictValueSchema>;

/** Trial outcome (BUILD_SPEC §6.3, §9.2 `verdict_result`). */
export const TRIAL_OUTCOMES = ['guilty', 'innocent'] as const;
export const TrialOutcomeSchema = z.enum(TRIAL_OUTCOMES);
export type TrialOutcome = z.infer<typeof TrialOutcomeSchema>;

/**
 * Kinds of private night result delivered to an individual seat
 * (BUILD_SPEC §6.7, §6.8, §9.2 `private_result`). Original noir wording for
 * each lives in `strings.ts`; this enum is the mechanical key.
 *
 * - sheriff_result      — "suspicious" / "not suspicious".
 * - investigator_result — an investigator result class (R1..R8).
 * - consigliere_result  — a target's EXACT role (Mafia Consigliere; batch A).
 * - janitor_result      — a cleaned victim's role + will (Mafia Janitor; batch A).
 * - lookout_result      — the list of seats that visited the watched seat.
 * - roleblocked         — "you were distracted" (your action was cancelled).
 * - block_failed        — "your target could not be distracted" (RB-immune).
 * - target_unreachable  — "your target was unreachable" (jailed target).
 * - attacked_survived   — "target fought off the attack" (your kill failed on
 *                         a night-immune / vested target).
 * - was_attacked        — you were attacked but survived (immune/vest).
 * - was_healed          — "you were attacked but nursed back to health".
 * - jailed              — you were hauled to a cell this night.
 * - blackmailed         — you are silenced in tomorrow's day chat (batch A).
 * - tracker_result      — the list of seats your tracked target VISITED (batch B).
 * - spy_result          — the list of seats the MAFIA visited this night (batch B).
 * - remember_result     — the role the Amnesiac remembered and became (batch B).
 * - psychic_vision      — a set of seats among which at least one is evil (odd
 *                         nights) or good (even nights); seats only, no roles
 *                         (Town Psychic; batch C).
 * - controlled          — your night action was seized and turned on a stranger by
 *                         a Witch (batch E); carries NO controller identity, NO
 *                         seats, NO roles — as leak-trivial as `roleblocked`.
 * - turned              — you have been bitten and TURNED into a Vampire (Vampire
 *                         faction). Delivered to the converted seat ALONE; carries
 *                         NO other seat's identity or role (not even the biter's),
 *                         so it is as leak-trivial as `roleblocked`. The seat's own
 *                         new alignment is its own — it learns it the way the
 *                         Amnesiac learns its remembered role.
 * - vampire_hunter_result — the Vampire Hunter's check: a single boolean
 *                         `isVampire` for the studied target. Carries the target
 *                         seat + a yes/no flag — NO role strings — so it is
 *                         leak-trivial (like the sheriff's suspicious/not read).
 * - recruited            — you have been drawn into the CULT (Cult faction).
 *                         Delivered to the converted seat ALONE; carries NO other
 *                         seat's identity or role (not even the Cult Leader's), so
 *                         it is as leak-trivial as `turned`/`roleblocked`. The
 *                         seat's own new alignment is its own to know.
 * - coroner_result      — the autopsied DEAD seat's exact role + the seats that
 *                         visited them the night they died (Town Coroner; batch F).
 *                         The role is of an ALREADY-revealed dead seat, so it leaks
 *                         nothing new; still addressed to the Coroner ALONE and
 *                         whitelisted as a per-seat role carrier (like
 *                         `consigliere_result`). Visitors are seat ids only.
 * - trapper_result      — the seat of a caller the Trapper's snare caught at its
 *                         ward (Town Trapper; batch F). Carries ONLY a seat id —
 *                         NO role strings — so it is leak-trivial (like the
 *                         Lookout's visitor list, but a single seat).
 */
export const PRIVATE_RESULT_KINDS = [
  'sheriff_result',
  'investigator_result',
  'consigliere_result',
  'janitor_result',
  'lookout_result',
  'roleblocked',
  'controlled',
  'block_failed',
  'target_unreachable',
  'attacked_survived',
  'was_attacked',
  'was_healed',
  'jailed',
  'blackmailed',
  'tracker_result',
  'spy_result',
  'remember_result',
  'psychic_vision',
  'turned',
  'vampire_hunter_result',
  'recruited',
  'coroner_result',
  'trapper_result',
] as const;
export const PrivateResultKindSchema = z.enum(PRIVATE_RESULT_KINDS);
export type PrivateResultKind = z.infer<typeof PrivateResultKindSchema>;
