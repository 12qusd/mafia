import { z } from 'zod';
import { SeatIdSchema } from './common.js';
import { SheriffResultSchema, InvestigatorClassSchema } from '../types/role.js';

/**
 * `private_result` payload variants (BUILD_SPEC §9.2, §6.7, §6.8). Discriminated
 * on `kind`; delivered individually to the owning seat. The human-readable noir
 * wording for each is resolved client-side via `strings.ts`.
 */

export const SheriffResultPayload = z.object({
  kind: z.literal('sheriff_result'),
  target: SeatIdSchema,
  result: SheriffResultSchema,
});

export const InvestigatorResultPayload = z.object({
  kind: z.literal('investigator_result'),
  target: SeatIdSchema,
  resultClass: InvestigatorClassSchema,
});

export const LookoutResultPayload = z.object({
  kind: z.literal('lookout_result'),
  target: SeatIdSchema,
  visitors: z.array(SeatIdSchema),
});

export const RoleblockedPayload = z.object({ kind: z.literal('roleblocked') });
export const BlockFailedPayload = z.object({ kind: z.literal('block_failed') });
export const TargetUnreachablePayload = z.object({ kind: z.literal('target_unreachable') });
export const AttackedSurvivedPayload = z.object({ kind: z.literal('attacked_survived') });
export const WasAttackedPayload = z.object({ kind: z.literal('was_attacked') });
export const WasHealedPayload = z.object({ kind: z.literal('was_healed') });
export const JailedPayload = z.object({ kind: z.literal('jailed') });

/** Discriminated union of all private-result payloads (without envelope). */
export const PrivateResultPayloadSchema = z.discriminatedUnion('kind', [
  SheriffResultPayload,
  InvestigatorResultPayload,
  LookoutResultPayload,
  RoleblockedPayload,
  BlockFailedPayload,
  TargetUnreachablePayload,
  AttackedSurvivedPayload,
  WasAttackedPayload,
  WasHealedPayload,
  JailedPayload,
]);
export type PrivateResultPayload = z.infer<typeof PrivateResultPayloadSchema>;
