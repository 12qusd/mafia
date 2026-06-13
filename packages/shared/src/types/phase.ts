import { z } from 'zod';

/**
 * Game phases (BUILD_SPEC §6.1).
 *
 * The state machine runs:
 *   LOBBY → ASSIGN → DAY_0 → (NIGHT → DAWN → DAY_DISCUSSION → DAY_VOTING
 *     → [TRIAL_DEFENSE → TRIAL_JUDGMENT → EXECUTION] →)* → GAME_OVER
 */
export const PHASES = [
  'LOBBY',
  'ASSIGN',
  'DAY_0',
  'NIGHT',
  'DAWN',
  'DAY_DISCUSSION',
  'DAY_VOTING',
  'TRIAL_DEFENSE',
  'TRIAL_JUDGMENT',
  'EXECUTION',
  'GAME_OVER',
] as const;

export const PhaseSchema = z.enum(PHASES);

/** A game phase. */
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * Which phase a match opens on after DAY_0. MVP ships only `day_no_lynch`
 * (BUILD_SPEC §6.1), but the config slot exists for future variants.
 */
export const FIRST_PHASES = ['day_no_lynch'] as const;
export const FirstPhaseSchema = z.enum(FIRST_PHASES);
export type FirstPhase = z.infer<typeof FirstPhaseSchema>;
