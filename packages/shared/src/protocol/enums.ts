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
 * - lookout_result      — the list of seats that visited the watched seat.
 * - roleblocked         — "you were distracted" (your action was cancelled).
 * - block_failed        — "your target could not be distracted" (RB-immune).
 * - target_unreachable  — "your target was unreachable" (jailed target).
 * - attacked_survived   — "target fought off the attack" (your kill failed on
 *                         a night-immune / vested target).
 * - was_attacked        — you were attacked but survived (immune/vest).
 * - was_healed          — "you were attacked but nursed back to health".
 * - jailed              — you were hauled to a cell this night.
 */
export const PRIVATE_RESULT_KINDS = [
  'sheriff_result',
  'investigator_result',
  'lookout_result',
  'roleblocked',
  'block_failed',
  'target_unreachable',
  'attacked_survived',
  'was_attacked',
  'was_healed',
  'jailed',
] as const;
export const PrivateResultKindSchema = z.enum(PRIVATE_RESULT_KINDS);
export type PrivateResultKind = z.infer<typeof PrivateResultKindSchema>;
