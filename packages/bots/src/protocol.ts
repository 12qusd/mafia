/**
 * Protocol surface re-exported for bots (BUILD_SPEC §9, §12.2).
 *
 * Bots are REAL protocol clients: they speak the shared zod schemas exactly like
 * the human client. This module centralizes the schema/type imports so the rest
 * of the bot code never re-derives the protocol — the single-source-of-truth
 * rule (§4.1, §9). Every inbound frame is parsed with {@link safeParseServerMessage};
 * unknown/invalid frames are ignored gracefully (§12.2: "never crash on any phase
 * sequence").
 */

import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  ClientMessageSchema,
  type ServerMessage,
  type ClientMessage,
} from '@nocturne/shared';

export {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  ClientMessageSchema,
  type ServerMessage,
  type ClientMessage,
};

export type SeatId = number;

/** Parse an inbound server frame; returns the typed message or null. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const res = ServerMessageSchema.safeParse(json);
  return res.success ? res.data : null;
}

/** Serialize a client message; validated against the shared schema first. */
export function serializeClientMessage(msg: ClientMessage): string {
  // We validate to guarantee the bot only ever emits protocol-legal frames —
  // a bug in a policy must surface here, not as silent server rejection.
  const res = ClientMessageSchema.safeParse(msg);
  if (!res.success) {
    throw new Error(`bot tried to send an invalid client frame: ${res.error.message}`);
  }
  return JSON.stringify(res.data);
}
