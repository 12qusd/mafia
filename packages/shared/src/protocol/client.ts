import { z } from 'zod';
import {
  envelope,
  SeatIdSchema,
  ChatTextSchema,
  WhisperTextSchema,
  LastWillTextSchema,
  DeathNoteTextSchema,
  InviteCodeSchema,
  ReportCommentSchema,
  AbilityIdSchema,
  ProtocolVersionLiteral,
} from './common.js';
import { LobbyConfigSchema, LobbyVisibilitySchema } from '../types/lobby.js';
import { ChatChannelSchema } from '../types/chat.js';
import { VerdictValueSchema, ReportCategorySchema } from './enums.js';
import { TestControlSchema } from './debug.js';

/**
 * Client → server messages (BUILD_SPEC §9.1, complete MVP catalog). Each is an
 * enveloped, zod-validated frame; the discriminated union {@link ClientMessage}
 * is the single source of truth shared by server and client.
 */

// hello {token?, protocolVersion}
export const HelloSchema = envelope('hello', {
  token: z.string().optional(),
  protocolVersion: ProtocolVersionLiteral,
});

// create_lobby {name, visibility, setupId, config?}
export const CreateLobbySchema = envelope('create_lobby', {
  name: z.string().min(1).max(64),
  visibility: LobbyVisibilitySchema,
  setupId: z.string(),
  config: LobbyConfigSchema.optional(),
});

// join_lobby {lobbyId | inviteCode, asSpectator?}
export const JoinLobbySchema = envelope('join_lobby', {
  lobbyId: z.string().optional(),
  inviteCode: InviteCodeSchema.optional(),
  asSpectator: z.boolean().optional(),
}).refine((m) => m.lobbyId !== undefined || m.inviteCode !== undefined, {
  message: 'join_lobby requires lobbyId or inviteCode',
});

// leave_lobby {}
export const LeaveLobbySchema = envelope('leave_lobby', {});

// lobby_config {config}  // host only
export const LobbyConfigMessageSchema = envelope('lobby_config', {
  config: LobbyConfigSchema,
});

// kick {seatOrUserId}  // host, pre-game
export const KickSchema = envelope('kick', {
  seatOrUserId: z.union([SeatIdSchema, z.string()]),
});

// start_game {}
export const StartGameSchema = envelope('start_game', {});

// chat {channel, text}
export const ChatSchema = envelope('chat', {
  channel: ChatChannelSchema,
  text: ChatTextSchema,
});

// whisper {toSeat, text}
export const WhisperClientSchema = envelope('whisper', {
  toSeat: SeatIdSchema,
  text: WhisperTextSchema,
});

// vote {target: SeatId | 'skip' | null}  // null = retract
export const VoteSchema = envelope('vote', {
  target: z.union([SeatIdSchema, z.literal('skip'), z.null()]),
});

// verdict {value}
export const VerdictSchema = envelope('verdict', {
  value: VerdictValueSchema,
});

// night_action {ability, target: SeatId | null}  // null = cancel
export const NightActionSchema = envelope('night_action', {
  ability: AbilityIdSchema,
  target: z.union([SeatIdSchema, z.null()]),
});

// day_ability {ability, target?}  // jailor select, mayor reveal
export const DayAbilitySchema = envelope('day_ability', {
  ability: AbilityIdSchema,
  target: SeatIdSchema.optional(),
});

// last_will {text}
export const LastWillSchema = envelope('last_will', {
  text: LastWillTextSchema,
});

// death_note {text}
export const DeathNoteSchema = envelope('death_note', {
  text: DeathNoteTextSchema,
});

// report_player {seat, category, comment?}
export const ReportPlayerSchema = envelope('report_player', {
  seat: SeatIdSchema,
  category: ReportCategorySchema,
  comment: ReportCommentSchema.optional(),
});

// admin_action {action, targetSeat?, points?, durationMs?, reason?}  // admin only
// In-game god powers (goal 8). The server enforces identity.isAdmin and logs
// every action to admin_audit; the engine receives only kill/stump as logged,
// replayable events. Points/ban/force-phase are handled server-side.
export const AdminActionSchema = envelope('admin_action', {
  action: z.enum(['kill', 'stump', 'force_phase', 'grant_points', 'revoke_points', 'temp_ban']),
  targetSeat: SeatIdSchema.optional(),
  points: z.number().int().min(0).max(100000).optional(),
  durationMs: z.number().int().min(0).max(30 * 24 * 60 * 60 * 1000).optional(),
  reason: z.string().max(200).optional(),
});

// ping {t}
export const PingSchema = envelope('ping', {
  t: z.number(),
});

/**
 * The discriminated union of every client→server message.
 *
 * `join_lobby` carries a `.refine`, so it is not a bare `ZodObject` and cannot
 * join a `z.discriminatedUnion`. We therefore use a plain `z.union`; the `type`
 * literal still makes parsing unambiguous and fast in practice.
 */
export const ClientMessageSchema = z.union([
  HelloSchema,
  CreateLobbySchema,
  JoinLobbySchema,
  LeaveLobbySchema,
  LobbyConfigMessageSchema,
  KickSchema,
  StartGameSchema,
  ChatSchema,
  WhisperClientSchema,
  VoteSchema,
  VerdictSchema,
  NightActionSchema,
  DayAbilitySchema,
  LastWillSchema,
  DeathNoteSchema,
  ReportPlayerSchema,
  AdminActionSchema,
  PingSchema,
  TestControlSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Per-message inferred types (handy for narrowing on `type`).
export type Hello = z.infer<typeof HelloSchema>;
export type CreateLobby = z.infer<typeof CreateLobbySchema>;
export type JoinLobby = z.infer<typeof JoinLobbySchema>;
export type LeaveLobby = z.infer<typeof LeaveLobbySchema>;
export type LobbyConfigMessage = z.infer<typeof LobbyConfigMessageSchema>;
export type Kick = z.infer<typeof KickSchema>;
export type StartGame = z.infer<typeof StartGameSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type WhisperClient = z.infer<typeof WhisperClientSchema>;
export type Vote = z.infer<typeof VoteSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type NightAction = z.infer<typeof NightActionSchema>;
export type DayAbility = z.infer<typeof DayAbilitySchema>;
export type LastWill = z.infer<typeof LastWillSchema>;
export type DeathNote = z.infer<typeof DeathNoteSchema>;
export type ReportPlayer = z.infer<typeof ReportPlayerSchema>;
export type AdminAction = z.infer<typeof AdminActionSchema>;
export type Ping = z.infer<typeof PingSchema>;
export type { TestControl } from './debug.js';
