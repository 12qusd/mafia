import { z } from 'zod';
import { SeatIdSchema } from './common.js';
import { SheriffResultSchema, InvestigatorClassSchema, RoleIdSchema } from '../types/role.js';

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

/**
 * Consigliere exact-role result (batch A). Carries the target seat's TRUE role.
 * This is the first private_result to deliver an actual role string; the engine
 * addresses it ONLY to the consigliere seat, so the leak auditors whitelist it
 * as a legitimate per-seat role carrier (alongside your_role / death_announce).
 */
export const ConsigliereResultPayload = z.object({
  kind: z.literal('consigliere_result'),
  target: SeatIdSchema,
  role: RoleIdSchema,
});

/**
 * Janitor cleaned-body result (batch A). The Janitor privately learns the role
 * and last will of the victim they sanitized — the very facts hidden from the
 * public reveal. Addressed ONLY to the janitor; whitelisted by the leak auditors
 * as a legitimate per-seat role carrier, like `consigliere_result`.
 */
export const JanitorResultPayload = z.object({
  kind: z.literal('janitor_result'),
  target: SeatIdSchema,
  role: RoleIdSchema,
  lastWill: z.string().optional(),
});

export const LookoutResultPayload = z.object({
  kind: z.literal('lookout_result'),
  target: SeatIdSchema,
  visitors: z.array(SeatIdSchema),
});

export const RoleblockedPayload = z.object({ kind: z.literal('roleblocked') });
/**
 * Witch control (batch E): the puppet learns their hand was moved tonight, with
 * NO controller identity and NO role/seat payload — exactly as leak-trivial as
 * `roleblocked`. The noir wording ("a force not your own moved your hand") lives
 * client-side in strings.ts. Delivered to the controlled seat alone.
 */
export const ControlledPayload = z.object({ kind: z.literal('controlled') });
export const BlockFailedPayload = z.object({ kind: z.literal('block_failed') });
export const TargetUnreachablePayload = z.object({ kind: z.literal('target_unreachable') });
export const AttackedSurvivedPayload = z.object({ kind: z.literal('attacked_survived') });
export const WasAttackedPayload = z.object({ kind: z.literal('was_attacked') });
export const WasHealedPayload = z.object({ kind: z.literal('was_healed') });
export const JailedPayload = z.object({ kind: z.literal('jailed') });
/** Blackmailer (batch A): you cannot speak in tomorrow's day chat. */
export const BlackmailedPayload = z.object({ kind: z.literal('blackmailed') });

/**
 * Tracker result (batch B). The list of seats the watched target VISITED this
 * night (the inverse of the Lookout's `lookout_result`). Carries only seat ids —
 * NO role strings — so it is leak-trivial.
 */
export const TrackerResultPayload = z.object({
  kind: z.literal('tracker_result'),
  target: SeatIdSchema,
  visited: z.array(SeatIdSchema),
});

/**
 * Spy result (batch B). The set of seats the MAFIA visited this night. Carries
 * only seat ids — NOT mafia identities and NOT role strings — so it is
 * leak-trivial. Delivered to the Spy alone.
 */
export const SpyResultPayload = z.object({
  kind: z.literal('spy_result'),
  seats: z.array(SeatIdSchema),
});

/**
 * Amnesiac remember result (batch B). Confirms the role the Amnesiac remembered
 * and BECAME. Carries the Amnesiac's OWN (new) role string, addressed ONLY to
 * the amnesiac — exactly like `your_role` for self — so the leak auditors
 * whitelist it as a legitimate per-seat role carrier.
 */
export const RememberResultPayload = z.object({
  kind: z.literal('remember_result'),
  target: SeatIdSchema,
  role: RoleIdSchema,
});

/**
 * Psychic vision result (batch C). A set of living seats among which AT LEAST
 * ONE is evil (`parity: 'evil'`, odd nights) or AT LEAST ONE is good
 * (`parity: 'good'`, even nights). Carries ONLY seat ids and the parity tag —
 * NO role or faction strings — so it is leak-trivial and needs no whitelist.
 * Delivered to the Psychic alone.
 */
export const PsychicVisionPayload = z.object({
  kind: z.literal('psychic_vision'),
  parity: z.enum(['evil', 'good']),
  seats: z.array(SeatIdSchema),
});

/**
 * Vampire turned result (Vampire faction). The bitten seat learns they have been
 * CONVERTED into a Vampire. Carries NO other seat's identity or role (not even the
 * biter's) — exactly as leak-trivial as `roleblocked`/`controlled`. The seat's own
 * new alignment is its own to know (like the Amnesiac's remember). Delivered to
 * the converted seat ALONE.
 */
export const TurnedPayload = z.object({ kind: z.literal('turned') });

/**
 * Vampire Hunter check result (Vampire faction). The Hunter learns whether the
 * studied target is a vampire — a single boolean against the target seat. Carries
 * ONLY a seat id and a yes/no flag — NO role strings — so it is leak-trivial (like
 * the sheriff's suspicious/not read). Delivered to the Hunter alone.
 */
export const VampireHunterResultPayload = z.object({
  kind: z.literal('vampire_hunter_result'),
  target: SeatIdSchema,
  isVampire: z.boolean(),
});

/**
 * Cult recruited result (Cult faction). The recruited seat learns they have been
 * drawn into the Cult. Carries NO other seat's identity or role (not even the Cult
 * Leader's) — exactly as leak-trivial as `turned`/`roleblocked`. Delivered to the
 * converted seat ALONE.
 */
export const RecruitedPayload = z.object({ kind: z.literal('recruited') });

/** Discriminated union of all private-result payloads (without envelope). */
export const PrivateResultPayloadSchema = z.discriminatedUnion('kind', [
  SheriffResultPayload,
  InvestigatorResultPayload,
  ConsigliereResultPayload,
  JanitorResultPayload,
  LookoutResultPayload,
  RoleblockedPayload,
  ControlledPayload,
  BlockFailedPayload,
  TargetUnreachablePayload,
  AttackedSurvivedPayload,
  WasAttackedPayload,
  WasHealedPayload,
  JailedPayload,
  BlackmailedPayload,
  TrackerResultPayload,
  SpyResultPayload,
  RememberResultPayload,
  PsychicVisionPayload,
  TurnedPayload,
  VampireHunterResultPayload,
  RecruitedPayload,
]);
export type PrivateResultPayload = z.infer<typeof PrivateResultPayloadSchema>;
