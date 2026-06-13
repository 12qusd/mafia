import { z } from 'zod';
import { PROTOCOL_VERSION } from '../constants.js';
import {
  CHAT_TEXT_MAX,
  WHISPER_TEXT_MAX,
  LAST_WILL_MAX,
  DEATH_NOTE_MAX,
  DISPLAY_NAME_MAX,
  REPORT_COMMENT_MAX,
  INVITE_CODE_LENGTH,
} from '../constants.js';

/**
 * Shared protocol building blocks (BUILD_SPEC §9). Every message carries the
 * `{v: 1, type, ...payload}` envelope; these helpers keep that uniform.
 */

/** A seat index on the wire (non-negative integer). */
export const SeatIdSchema = z.number().int().min(0);

/** The literal protocol version every envelope carries. */
export const ProtocolVersionLiteral = z.literal(PROTOCOL_VERSION);

/**
 * Build a client/server message schema: merges the `{v, type}` envelope onto a
 * payload shape. `type` is a literal so the result participates in a
 * discriminated union.
 */
export function envelope<TType extends string, TShape extends z.ZodRawShape>(
  type: TType,
  shape: TShape,
) {
  return z
    .object({
      v: ProtocolVersionLiteral,
      type: z.literal(type),
    })
    .extend(shape);
}

// --- Reusable payload fragments -------------------------------------------

/** Trimmed display name. */
export const DisplayNameSchema = z.string().min(1).max(DISPLAY_NAME_MAX);

/** Day chat / general chat body. */
export const ChatTextSchema = z.string().min(1).max(CHAT_TEXT_MAX);

/** Whisper body. */
export const WhisperTextSchema = z.string().min(1).max(WHISPER_TEXT_MAX);

/** Last-will body (may be empty to clear). */
export const LastWillTextSchema = z.string().max(LAST_WILL_MAX);

/** Death-note body (may be empty to clear). */
export const DeathNoteTextSchema = z.string().max(DEATH_NOTE_MAX);

/** Private-lobby invite code. */
export const InviteCodeSchema = z.string().length(INVITE_CODE_LENGTH);

/** Free-text report comment. */
export const ReportCommentSchema = z.string().max(REPORT_COMMENT_MAX);

/** A night/day ability identifier (the role's ability key, validated by server). */
export const AbilityIdSchema = z.string().min(1);
