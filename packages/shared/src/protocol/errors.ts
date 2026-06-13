import { z } from 'zod';

/**
 * Error codes (BUILD_SPEC §9: `{type:'error', code, detail?}`). Stable machine
 * keys; human-readable messages live in `strings.ts`. The server replies with
 * one of these and never crashes on malformed input (§9, §12.4).
 */
export const ERROR_CODES = [
  // Protocol / transport
  'bad_message', // failed envelope/payload validation
  'unknown_type', // unrecognized message type
  'unsupported_protocol', // protocolVersion mismatch on hello
  'rate_limited', // too many messages (§6.4 / §11.5)
  'not_authenticated', // action requires a session
  // Lobby
  'lobby_not_found',
  'lobby_full',
  'invalid_invite_code',
  'not_host', // host-only action by a non-host
  'already_in_lobby',
  'not_in_lobby',
  'bad_config', // config out of bounds (§6.2)
  'unknown_setup',
  'cannot_start', // start preconditions unmet (§7.4)
  // In-game command validation (§5.5)
  'not_in_game',
  'wrong_phase', // command not legal this phase
  'seat_dead', // dead seat may not take this action
  'illegal_target', // target not permitted
  'ability_unavailable', // role lacks this ability / no uses left
  'not_your_turn', // e.g. not on trial / not the accused context
  'whispers_disabled',
  'spectator_forbidden', // spectators may not take game actions
  // Generic
  'forbidden',
  'internal_error',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
