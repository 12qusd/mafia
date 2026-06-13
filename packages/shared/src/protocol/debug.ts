import { z } from 'zod';
import { envelope, SeatIdSchema } from './common.js';
import { PhaseSchema } from '../types/phase.js';
import { RoleIdSchema } from '../types/role.js';
import { FactionSchema } from '../types/faction.js';
import { DeathCauseSchema } from '../types/death.js';
import { VerdictValueSchema } from './enums.js';

/**
 * TEST-MODE god-view + control protocol (NOCTURNE test mode).
 *
 * These frames exist ONLY for gated test-mode lobbies (§5 remains law for
 * normal games). The server emits `debug_*` frames EXCLUSIVELY to the test
 * lobby's host audience (the host seat and/or the host spectating). A normal
 * (non-test) game NEVER emits any of these — asserted by the bots leak auditor.
 *
 * The client agent builds the god-view UI from these schemas. They are additive:
 * existing message catalogs are untouched.
 */

// ---------------------------------------------------------------------------
// debug_state — full god-view snapshot of the live game.
// ---------------------------------------------------------------------------

/** One seat's complete (normally-secret) live state for the god view. */
export const DebugSeatSchema = z.object({
  seat: SeatIdSchema,
  name: z.string(),
  role: RoleIdSchema,
  faction: FactionSchema,
  alive: z.boolean(),
  revealed: z.boolean(),
  /** Remaining metered uses (bullets/executions/vests), null if unlimited. */
  usesRemaining: z.number().int().nullable(),
  /** Remaining self-target uses (doctor self-heal), null if N/A. */
  selfUsesRemaining: z.number().int().nullable(),
  /** Night-immune by role this night (Godfather/SK/Executioner etc.). */
  nightImmune: z.boolean(),
  /** Mayor has revealed (vote weight 3, unhealable). */
  mayorRevealed: z.boolean(),
  /** Executioner's assigned target seat, or null. */
  exeTarget: SeatIdSchema.nullable(),
  /** Whether this seat has queued a leave (suicide next night). */
  leaving: z.boolean(),
  connected: z.boolean(),
  afk: z.boolean(),
});
export type DebugSeat = z.infer<typeof DebugSeatSchema>;

/** A submitted night intent (who → ability → whom). */
export const DebugIntentSchema = z.object({
  seat: SeatIdSchema,
  ability: z.string(),
  target: SeatIdSchema.nullable(),
});
export type DebugIntent = z.infer<typeof DebugIntentSchema>;

/** Open-vote tally row (mirror of vote_update for the god view). */
export const DebugTallySchema = z.object({
  seat: SeatIdSchema,
  weight: z.number().int().min(0),
});

/** debug_state {phase, dayNumber, seats[], intents[], jailTarget, marks, ...} */
export const DebugStateSchema = envelope('debug_state', {
  phase: PhaseSchema,
  dayNumber: z.number().int().min(0),
  nightNumber: z.number().int().min(0),
  /** Every seat's true role/faction/alive/uses/immunity state. */
  seats: z.array(DebugSeatSchema),
  /** Mafia roster (living + dead members, seat ids). */
  mafiaRoster: z.array(SeatIdSchema),
  /** Currently submitted night intents (cleared each night). */
  intents: z.array(DebugIntentSchema),
  /** Jailor's selected prisoner for the coming night, or null. */
  jailTarget: SeatIdSchema.nullable(),
  /** Pending jester-grief candidate voters (scheduled night kill), or null. */
  pendingJesterGrief: z.array(SeatIdSchema).nullable(),
  /** Open nomination tallies (DAY_VOTING). */
  voteTallies: z.array(DebugTallySchema),
  /** Per-voter open vote (DAY_VOTING). */
  votesBySeat: z.array(
    z.object({ seat: SeatIdSchema, target: z.union([SeatIdSchema, z.literal('skip')]) }),
  ),
  /** Active trial: accused seat + per-voter verdicts, or null. */
  trial: z
    .object({
      accused: SeatIdSchema,
      verdicts: z.array(z.object({ seat: SeatIdSchema, value: VerdictValueSchema })),
    })
    .nullable(),
  /** Executioner targets: exe seat → target seat. */
  executionerTargets: z.array(z.object({ seat: SeatIdSchema, target: SeatIdSchema })),
});
export type DebugState = z.infer<typeof DebugStateSchema>;

// ---------------------------------------------------------------------------
// debug_trace — full ResolutionTrace array + dawn deaths for one night.
// ---------------------------------------------------------------------------

/**
 * A resolution trace record. The engine owns the precise discriminated union
 * shape (`ResolutionTrace`); on the wire it is a structured record keyed by
 * `step`. We validate it loosely so the protocol layer never rejects a valid
 * engine trace (the engine is the source of truth for its content).
 */
export const DebugTraceRecordSchema = z
  .object({ step: z.string() })
  .passthrough();
export type DebugTraceRecord = z.infer<typeof DebugTraceRecordSchema>;

/** debug_trace {dayNumber, traces[], deaths[]} — after each night resolution. */
export const DebugTraceSchema = envelope('debug_trace', {
  /** Day number at the time of this night's resolution. */
  dayNumber: z.number().int().min(0),
  nightNumber: z.number().int().min(0),
  /** The full ResolutionTrace array produced by THIS night's resolution. */
  traces: z.array(DebugTraceRecordSchema),
  /** Dawn deaths summary for this night, in fixed report order. */
  deaths: z.array(z.object({ seat: SeatIdSchema, cause: DeathCauseSchema })),
});
export type DebugTrace = z.infer<typeof DebugTraceSchema>;

// ---------------------------------------------------------------------------
// debug_event — mirror of every validated GameEvent appended to the action log.
// ---------------------------------------------------------------------------

/** debug_event {seq, phase, eventType, seat?, payload, ts} */
export const DebugEventSchema = envelope('debug_event', {
  /** Monotonic action-log sequence number. */
  seq: z.number().int().min(0),
  /** Phase the event was applied in. */
  phase: z.string(),
  /** The GameEvent type (chat, vote, night_action, phase_end, …). */
  eventType: z.string(),
  /** Acting seat, if the event has one. */
  seat: SeatIdSchema.optional(),
  /** The full event payload (opaque structured record). */
  payload: z.unknown(),
  ts: z.number().int(),
});
export type DebugEvent = z.infer<typeof DebugEventSchema>;

// ---------------------------------------------------------------------------
// test_control — host-only control command for a test lobby (client → server).
// ---------------------------------------------------------------------------

export const TEST_BOT_POLICIES = ['scripted', 'llm'] as const;
export const TestBotPolicySchema = z.enum(TEST_BOT_POLICIES);
export type TestBotPolicy = z.infer<typeof TestBotPolicySchema>;

/**
 * test_control {action} — host of a test lobby only.
 *   - end_phase: immediately schedule the current phase's phase_end event.
 *   - request_state: resend debug_state.
 *   - add_bot {count?, policy?}: pre-game, fill seats with in-process bots.
 *   - remove_bot {seatOrAll}: pre-game, drop a backfill bot (or all).
 */
export const TestControlSchema = z.discriminatedUnion('action', [
  z.object({
    v: z.literal(1),
    type: z.literal('test_control'),
    action: z.literal('end_phase'),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('test_control'),
    action: z.literal('request_state'),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('test_control'),
    action: z.literal('add_bot'),
    count: z.number().int().min(1).max(15).optional(),
    policy: TestBotPolicySchema.optional(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('test_control'),
    action: z.literal('remove_bot'),
    seatOrAll: z.union([SeatIdSchema, z.literal('all')]),
  }),
]);
export type TestControl = z.infer<typeof TestControlSchema>;

/** Union of all server→client debug frames (test-mode god audience only). */
export const DebugMessageSchema = z.union([
  DebugStateSchema,
  DebugTraceSchema,
  DebugEventSchema,
]);
export type DebugMessage = z.infer<typeof DebugMessageSchema>;

/** The set of debug frame `type` literals (used by the leak auditor allowlist). */
export const DEBUG_MESSAGE_TYPES = ['debug_state', 'debug_trace', 'debug_event'] as const;
