import { z } from 'zod';

/**
 * Chat channels (BUILD_SPEC §6.4).
 *
 * - lobby   — LOBBY phase; everyone in the lobby.
 * - day     — all day phases; living seats write, everyone reads.
 * - mafia   — NIGHT; living mafia seats.
 * - jail    — NIGHT (if jailed); jailor (masked as "Jailor") + prisoner.
 * - dead    — always after death; dead seats.
 * - whisper — day phases; sender → recipient (public "X whispers to Y" meta).
 */
export const CHAT_CHANNELS = ['lobby', 'day', 'mafia', 'jail', 'dead', 'whisper'] as const;

export const ChatChannelSchema = z.enum(CHAT_CHANNELS);

/** A chat channel. */
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

/**
 * When the jailor speaks in the jail channel, their identity is masked to the
 * prisoner as this fixed label (BUILD_SPEC §6.4, §5).
 */
export const JAILOR_CHAT_ALIAS = 'Jailor' as const;
export type JailorChatAlias = typeof JAILOR_CHAT_ALIAS;
