/**
 * A live WebSocket connection (BUILD_SPEC §8, §9).
 *
 * Wraps the raw `ws` socket with: the resolved identity, rate limiters, and the
 * lobby/room it currently belongs to. Seats are bound to identity, not socket
 * (§8): a Connection points at a seat via its room membership, and on reconnect
 * a new Connection re-attaches to the same seat (duplicate ⇒ newest wins).
 *
 * Per §5 the Connection never sends directly; all delivery is via the scope's
 * ScopedTransport. The only place this object touches `.send` is through
 * `sendToSocket` (the transport's single bare-socket path), used for pre-lobby
 * frames (welcome/error/pong).
 */

import type { ServerMessage } from '@nocturne/shared';
import type { Identity } from '../auth/identity.js';
import { makeSocketLimiter, ChatLimiter, type SlidingWindow } from '../ratelimit.js';
import { sendToSocket, type Sendable } from '../transport.js';

let nextConnId = 1;

export interface RawSocket extends Sendable {
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export class Connection {
  readonly id = nextConnId++;
  identity: Identity | null = null;
  helloDone = false;
  /** Lobby id this connection is in, if any. */
  lobbyId: string | null = null;
  /** Whether the connection joined its lobby/room as a spectator (§7.8). */
  spectator = false;

  readonly socketLimiter: SlidingWindow = makeSocketLimiter();
  readonly chatLimiter = new ChatLimiter();
  /** Clock offset estimation sample from last ping (§6.2); informational. */
  lastPingT = 0;

  constructor(readonly socket: RawSocket) {}

  /** Send a frame to this socket directly (pre-lobby only: welcome/error/pong). */
  send(msg: ServerMessage): void {
    sendToSocket(this.socket, msg);
  }

  close(code = 1000, reason = ''): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // ignore
    }
  }

  get identityId(): string | null {
    return this.identity?.id ?? null;
  }
}
