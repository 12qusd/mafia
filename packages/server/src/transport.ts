/**
 * Transport layer — the ONLY socket-send paths (BUILD_SPEC §5, the prime
 * invariant).
 *
 * Nothing outside this module may call `socket.send` directly. Every outbound
 * message goes through `sendTo(seatIds, msg)`, `broadcastPublic(msg)`, or
 * `dispatchEffect(...)` which maps an engine `Effect`'s `to` audience
 * ('public'|'dead'|'mafia'|SeatId[]) onto the right sockets. Membership of the
 * mafia/dead audiences is read from engine state (via the engine adapter view),
 * never from the message body. Spectators receive ONLY 'public' frames and never
 * a secret, regardless of `deadSeeAll` (§5, §7.8).
 *
 * ESLint: `no-restricted-syntax` forbids `.send(` member calls in every other
 * source file (see eslint.config.js / DECISIONS.md). This module is the
 * single exception.
 */

import type { Effect, SeatId, ServerMessage } from '@nocturne/shared';
import { ServerMessageSchema } from '@nocturne/shared';
import { log } from './log.js';

/** Minimal socket surface this module needs (satisfied by `ws`'s WebSocket). */
export interface Sendable {
  readyState: number;
  send(data: string): void;
}

/** OPEN ready-state constant from the `ws` library (1). */
const WS_OPEN = 1;

/**
 * A registry of live sockets for one delivery scope (a lobby or a room). Maps
 * recipient identities/seats to sockets and exposes the audience predicates the
 * dispatcher needs.
 */
export interface AudienceProvider {
  /** Sockets to receive 'public' (every connected client incl. spectators). */
  publicSockets(): Iterable<Sendable>;
  /** Sockets bound to the given seat ids (player seats only, no spectators). */
  socketsForSeats(seats: Iterable<SeatId>): Iterable<Sendable>;
  /** Seats currently considered mafia members (engine-derived). */
  mafiaSeats(): SeatId[];
  /** Seats currently dead (engine-derived). */
  deadSeats(): SeatId[];
}

let totalFramesSent = 0;

/** Telemetry hook: count of frames sent across all scopes. */
export function framesSent(): number {
  return totalFramesSent;
}

/**
 * Serialize and send one message to one socket. PRIVATE to this module — the
 * only place `.send` is called. Validates the frame against the server schema in
 * non-production to catch malformed outbound messages early (defense in depth
 * for §5; a malformed secret-bearing frame is a leak).
 */
function rawSend(socket: Sendable, msg: ServerMessage): void {
  if (socket.readyState !== WS_OPEN) return;
  let data: string;
  try {
    if (process.env.NODE_ENV !== 'production') {
      const parsed = ServerMessageSchema.safeParse(msg);
      if (!parsed.success) {
        log.error('outbound frame failed schema validation; dropping', {
          type: (msg as { type?: string })?.type,
        });
        return;
      }
    }
    data = JSON.stringify(msg);
  } catch (err) {
    log.error('failed to serialize outbound frame', { err: String(err) });
    return;
  }
  try {
    socket.send(data);
    totalFramesSent++;
  } catch (err) {
    log.warn('socket.send threw', { err: String(err) });
  }
}

/** Send a message to one bare socket (used pre-seat, e.g. hello/welcome). */
export function sendToSocket(socket: Sendable, msg: ServerMessage): void {
  rawSend(socket, msg);
}

/**
 * Transport bound to one audience scope. Construct one per lobby/room. These
 * three methods (`sendTo`, `broadcastPublic`, `dispatchEffect`) are the sole
 * delivery API the rest of the server uses.
 */
export class ScopedTransport {
  constructor(private readonly audience: AudienceProvider) {}

  /** Deliver to an explicit set of seats (your_role, private_result, whisper…). */
  sendTo(seatIds: Iterable<SeatId>, msg: ServerMessage): void {
    for (const sock of this.audience.socketsForSeats(seatIds)) rawSend(sock, msg);
  }

  /** Deliver to every connected client including spectators (public state). */
  broadcastPublic(msg: ServerMessage): void {
    for (const sock of this.audience.publicSockets()) rawSend(sock, msg);
  }

  /**
   * Deliver an engine Effect verbatim to the audience named by `to`. This is the
   * single dispatcher (§5 rule 1): the engine decides entitlement, transport
   * only routes. `deadSeeAll` is irrelevant here — spectators are not in any
   * seat audience and only ever receive 'public'.
   */
  dispatchEffect(effect: Effect): void {
    const { to, msg } = effect;
    if (to === 'public') {
      this.broadcastPublic(msg);
    } else if (to === 'mafia') {
      this.sendTo(this.audience.mafiaSeats(), msg);
    } else if (to === 'dead') {
      this.sendTo(this.audience.deadSeats(), msg);
    } else {
      // SeatId[] — an explicit, individually addressed set.
      this.sendTo(to, msg);
    }
  }

  /** Convenience: dispatch a batch of effects in order. */
  dispatchAll(effects: Iterable<Effect>): void {
    for (const e of effects) this.dispatchEffect(e);
  }
}
