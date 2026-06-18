import { z } from 'zod';
import { envelope, SeatIdSchema, ProtocolVersionLiteral } from './common.js';
import { LobbySchema, AbilityInfoSchema, TallyEntrySchema, SeatSnapshotSchema } from './objects.js';
import { PublicSeatSchema } from '../types/seat.js';
import { LobbyConfigSchema } from '../types/lobby.js';
import { PhaseSchema } from '../types/phase.js';
import { ChatChannelSchema } from '../types/chat.js';
import { RoleIdSchema } from '../types/role.js';
import { FactionSchema } from '../types/faction.js';
import { DeathCauseSchema } from '../types/death.js';
import { WinningPartySchema, SeatOutcomeSchema } from '../types/outcome.js';
import { VerdictValueSchema, TrialOutcomeSchema } from './enums.js';
import { ErrorCodeSchema } from './errors.js';
import { PrivateResultPayloadSchema } from './private_result.js';
import { DebugStateSchema, DebugTraceSchema, DebugEventSchema } from './debug.js';
import { PointsBreakdownSchema, UserStatsSummarySchema } from '../types/points.js';

/**
 * Server → client messages (BUILD_SPEC §9.2, complete MVP catalog). Each is an
 * enveloped, zod-validated frame; the discriminated union {@link ServerMessage}
 * is the single source of truth shared by server and client. Per §5 the server
 * composes these per recipient — there is no broadcast secret-bearing object.
 */

// welcome {userId?, guestId?, resume?: SeatSnapshot}
export const WelcomeSchema = envelope('welcome', {
  userId: z.string().optional(),
  guestId: z.string().optional(),
  resume: SeatSnapshotSchema.optional(),
});

// lobby_state {lobby}
export const LobbyStateSchema = envelope('lobby_state', {
  lobby: LobbySchema,
});

// game_started {seats: PublicSeat[], setupId, config}
export const GameStartedSchema = envelope('game_started', {
  seats: z.array(PublicSeatSchema),
  setupId: z.string(),
  config: LobbyConfigSchema,
});

// your_role {role, faction, abilities, mates?}
export const YourRoleSchema = envelope('your_role', {
  role: RoleIdSchema,
  faction: FactionSchema,
  abilities: z.array(AbilityInfoSchema),
  mates: z.array(SeatIdSchema).optional(),
});

// phase_change {phase, dayNumber, endsAt}
export const PhaseChangeSchema = envelope('phase_change', {
  phase: PhaseSchema,
  dayNumber: z.number().int().min(0),
  /** Server epoch ms when the phase ends; null for phases without a deadline. */
  endsAt: z.number().int().nullable(),
});

// chat_message {channel, fromSeat|'Jailor', text, ts}
export const ChatMessageSchema = envelope('chat_message', {
  channel: ChatChannelSchema,
  from: z.union([SeatIdSchema, z.literal('Jailor')]),
  text: z.string(),
  ts: z.number().int(),
});

// whisper_meta {fromSeat, toSeat}  // public
export const WhisperMetaSchema = envelope('whisper_meta', {
  fromSeat: SeatIdSchema,
  toSeat: SeatIdSchema,
});

// whisper {fromSeat, text}  // to recipient only
export const WhisperServerSchema = envelope('whisper', {
  fromSeat: SeatIdSchema,
  text: z.string(),
});

// vote_update {tallies, votesBySeat}
export const VoteUpdateSchema = envelope('vote_update', {
  tallies: z.array(TallyEntrySchema),
  /** Map of voter seat → their current target ('skip' or seat). */
  votesBySeat: z.array(
    z.object({
      seat: SeatIdSchema,
      target: z.union([SeatIdSchema, z.literal('skip')]),
    }),
  ),
});

// trial_start {accusedSeat}
export const TrialStartSchema = envelope('trial_start', {
  accusedSeat: SeatIdSchema,
});

// verdict_result {accusedSeat, outcome, votes}
export const VerdictResultSchema = envelope('verdict_result', {
  accusedSeat: SeatIdSchema,
  outcome: TrialOutcomeSchema,
  votes: z.array(
    z.object({
      seat: SeatIdSchema,
      value: VerdictValueSchema,
    }),
  ),
});

// death_announce {seat, role, lastWill?, deathNote?, cause}
export const DeathAnnounceSchema = envelope('death_announce', {
  seat: SeatIdSchema,
  role: RoleIdSchema,
  lastWill: z.string().optional(),
  deathNote: z.string().optional(),
  cause: DeathCauseSchema,
});

// private_result {kind, ...}
export const PrivateResultSchema = z
  .object({
    v: ProtocolVersionLiteral,
    type: z.literal('private_result'),
  })
  .and(PrivateResultPayloadSchema);

// day_ability_ack {ability, target}
export const DayAbilityAckSchema = envelope('day_ability_ack', {
  ability: z.string(),
  target: SeatIdSchema.optional(),
});

// game_over {winners, allRoles, seed, matchId}
export const GameOverSchema = envelope('game_over', {
  winners: z.array(WinningPartySchema),
  allRoles: z.array(
    z.object({
      seat: SeatIdSchema,
      role: RoleIdSchema,
      faction: FactionSchema,
      outcome: SeatOutcomeSchema,
    }),
  ),
  seed: z.string(),
  matchId: z.string(),
});

// points_awarded {breakdown, stats}  // per-recipient; only their own points (§5)
// Sent after game_over to each seated, registered (non-guest) player in a
// non-TEST match. Points are computed by the server (the engine stays pure).
export const PointsAwardedSchema = envelope('points_awarded', {
  matchId: z.string(),
  breakdown: PointsBreakdownSchema,
  /** The player's updated lifetime stats after this match's award. */
  stats: UserStatsSummarySchema,
  /** Achievement keys newly unlocked this match (subset of breakdown). */
  newAchievements: z.array(z.string()),
});

// seat_status {seat, connected, afk}
export const SeatStatusSchema = envelope('seat_status', {
  seat: SeatIdSchema,
  connected: z.boolean(),
  afk: z.boolean(),
});

// seat_transform {seat, stumped}  // public; admin turned a seat into a stump
// (goal 8). Leak-safe: carries no secret — being a non-voting town stump is
// public knowledge.
export const SeatTransformSchema = envelope('seat_transform', {
  seat: SeatIdSchema,
  stumped: z.boolean(),
});

// error {code, detail?}
export const ErrorSchema = envelope('error', {
  code: ErrorCodeSchema,
  detail: z.string().optional(),
});

// pong {t}
export const PongSchema = envelope('pong', {
  t: z.number(),
});

// force_update {minProtocolVersion}
export const ForceUpdateSchema = envelope('force_update', {
  minProtocolVersion: z.number().int().min(1),
});

/**
 * Discriminated union of every server→client message.
 *
 * `private_result` is built with `.and()` (envelope ∧ payload union) and is not
 * a bare `ZodObject`, so we use `z.union` rather than `z.discriminatedUnion`.
 * The `type` literal still keeps parsing unambiguous.
 */
export const ServerMessageSchema = z.union([
  WelcomeSchema,
  LobbyStateSchema,
  GameStartedSchema,
  YourRoleSchema,
  PhaseChangeSchema,
  ChatMessageSchema,
  WhisperMetaSchema,
  WhisperServerSchema,
  VoteUpdateSchema,
  TrialStartSchema,
  VerdictResultSchema,
  DeathAnnounceSchema,
  PrivateResultSchema,
  DayAbilityAckSchema,
  GameOverSchema,
  PointsAwardedSchema,
  SeatStatusSchema,
  SeatTransformSchema,
  ErrorSchema,
  PongSchema,
  ForceUpdateSchema,
  DebugStateSchema,
  DebugTraceSchema,
  DebugEventSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// Per-message inferred types.
export type Welcome = z.infer<typeof WelcomeSchema>;
export type LobbyState = z.infer<typeof LobbyStateSchema>;
export type GameStarted = z.infer<typeof GameStartedSchema>;
export type YourRole = z.infer<typeof YourRoleSchema>;
export type PhaseChange = z.infer<typeof PhaseChangeSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type WhisperMeta = z.infer<typeof WhisperMetaSchema>;
export type WhisperServer = z.infer<typeof WhisperServerSchema>;
export type VoteUpdate = z.infer<typeof VoteUpdateSchema>;
export type TrialStart = z.infer<typeof TrialStartSchema>;
export type VerdictResult = z.infer<typeof VerdictResultSchema>;
export type DeathAnnounce = z.infer<typeof DeathAnnounceSchema>;
export type PrivateResult = z.infer<typeof PrivateResultSchema>;
export type DayAbilityAck = z.infer<typeof DayAbilityAckSchema>;
export type GameOver = z.infer<typeof GameOverSchema>;
export type PointsAwarded = z.infer<typeof PointsAwardedSchema>;
export type SeatStatus = z.infer<typeof SeatStatusSchema>;
export type SeatTransform = z.infer<typeof SeatTransformSchema>;
export type ServerError = z.infer<typeof ErrorSchema>;
export type Pong = z.infer<typeof PongSchema>;
export type ForceUpdate = z.infer<typeof ForceUpdateSchema>;
export type { DebugState, DebugTrace, DebugEvent } from './debug.js';
