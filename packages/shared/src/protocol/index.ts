import type { z } from 'zod';
import type { AddressedEffect } from '../types/effect.js';
import { ClientMessageSchema, type ClientMessage } from './client.js';
import { ServerMessageSchema, type ServerMessage } from './server.js';

export * from './common.js';
export * from './enums.js';
export * from './errors.js';
export * from './objects.js';
export * from './private_result.js';
export * from './debug.js';
export * from './client.js';
export * from './server.js';

/**
 * Concrete addressed-effect type (BUILD_SPEC §5, §6). An {@link Effect} pairs an
 * audience with a server message; the engine emits these and the server
 * transport delivers them verbatim.
 */
export type Effect = AddressedEffect<ServerMessage>;

/** Parse an unknown frame as a client message. Throws on invalid input. */
export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

/** Safe-parse an unknown frame as a client message (never throws). */
export function safeParseClientMessage(
  input: unknown,
): z.SafeParseReturnType<unknown, ClientMessage> {
  return ClientMessageSchema.safeParse(input);
}

/** Parse an unknown frame as a server message. Throws on invalid input. */
export function parseServerMessage(input: unknown): ServerMessage {
  return ServerMessageSchema.parse(input);
}

/** Safe-parse an unknown frame as a server message (never throws). */
export function safeParseServerMessage(
  input: unknown,
): z.SafeParseReturnType<unknown, ServerMessage> {
  return ServerMessageSchema.safeParse(input);
}
