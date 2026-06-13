/**
 * WebSocket gateway (BUILD_SPEC §9, §12.4).
 *
 * Owns the set of live Connections. For every inbound frame:
 *   1. enforce the 8 KB size cap → `error{bad_message}` (never crash),
 *   2. tolerate malformed JSON → `error{bad_message}`,
 *   3. zod-validate via shared `ClientMessageSchema` → `error{bad_message}` /
 *      `error{unknown_type}`,
 *   4. enforce the connection-level rate limit (20/10s) → `error{rate_limited}`,
 *   5. dispatch to MessageHandlers (which never throws; gateway wraps anyway).
 *
 * The whole pipeline is wrapped so a malicious/buggy frame can never take down
 * the process (fuzz test in §12.4).
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { safeParseClientMessage, type ServerMessage } from '@nocturne/shared';
import type { GatewayContext } from './context.js';
import { Connection, type RawSocket } from './connection.js';
import { MessageHandlers } from './handlers.js';
import { sendToSocket } from '../transport.js';
import { log } from '../log.js';

/** Max inbound frame size (§9). */
export const MAX_FRAME_BYTES = 8 * 1024;

function errFrame(code: string, detail?: string): ServerMessage {
  return { v: 1, type: 'error', code, ...(detail ? { detail } : {}) } as ServerMessage;
}

export class Gateway {
  private wss: WebSocketServer | null = null;
  private readonly connections = new Set<Connection>();
  /** identity id → current connection (newest-wins enforcement, §8). */
  private readonly byIdentity = new Map<string, Connection>();
  private readonly handlers: MessageHandlers;

  constructor(private readonly ctx: GatewayContext) {
    this.handlers = new MessageHandlers(ctx, (conn) => this.bindIdentity(conn));
  }

  /** Attach to an existing HTTP server on the `/ws` path (§4.2 same port). */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = req.url ?? '';
      if (!url.startsWith('/ws')) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    });
    this.wss.on('connection', (ws: WebSocket) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
    const conn = new Connection(ws as unknown as RawSocket);
    this.connections.add(conn);
    this.ctx.telemetry.connectionOpened();

    ws.on('message', (data: unknown, isBinary: boolean) => {
      void this.onMessage(conn, data, isBinary);
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (err: Error) => {
      log.warn('ws error', { conn: conn.id, err: String(err) });
    });
  }

  private async onMessage(conn: Connection, data: unknown, isBinary: boolean): Promise<void> {
    try {
      if (isBinary) {
        sendToSocket(conn.socket, errFrame('bad_message', 'binary frames not accepted'));
        return;
      }
      // Size cap (§9). `data` is a Buffer from ws by default.
      const raw = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data as Buffer[]).toString('utf8')
          : String(data);
      if (Buffer.byteLength(raw, 'utf8') > MAX_FRAME_BYTES) {
        sendToSocket(conn.socket, errFrame('bad_message', 'frame too large'));
        return;
      }
      // Connection-level rate limit (§11.5).
      if (!conn.socketLimiter.tryAcquire()) {
        sendToSocket(conn.socket, errFrame('rate_limited'));
        return;
      }
      // Tolerant JSON parse (§9: malformed JSON tolerated).
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendToSocket(conn.socket, errFrame('bad_message', 'invalid json'));
        return;
      }
      // zod validation against the shared schema (§9).
      const result = safeParseClientMessage(parsed);
      if (!result.success) {
        const hasType = typeof (parsed as { type?: unknown })?.type === 'string';
        sendToSocket(conn.socket, errFrame(hasType ? 'bad_message' : 'bad_message'));
        return;
      }
      await this.handlers.handle(conn, result.data);
    } catch (err) {
      // Final safety net: a handler bug must not crash the process (§12.4).
      log.error('unhandled error in message pipeline', { conn: conn.id, err: String(err) });
      try {
        sendToSocket(conn.socket, errFrame('internal_error'));
      } catch {
        /* ignore */
      }
    }
  }

  /** Enforce newest-wins for an identity (§8). Called when hello binds identity. */
  private bindIdentity(conn: Connection): void {
    const id = conn.identityId;
    if (!id) return;
    const prev = this.byIdentity.get(id);
    if (prev && prev !== conn) {
      // Older connection is superseded; close it (newest wins, §8).
      prev.close(4000, 'superseded');
      this.connections.delete(prev);
    }
    this.byIdentity.set(id, conn);
  }

  private onClose(conn: Connection): void {
    this.connections.delete(conn);
    this.ctx.telemetry.connectionClosed();
    const id = conn.identityId;
    if (id && this.byIdentity.get(id) === conn) {
      this.byIdentity.delete(id);
      this.ctx.manager.onDisconnect(conn);
    } else if (id) {
      // A superseded socket closing: do not detach the live seat.
    }
  }

  /** Number of live connections (telemetry / drain). */
  connectionCount(): number {
    return this.connections.size;
  }

  /** Close all sockets (shutdown). */
  closeAll(): void {
    for (const c of this.connections) c.close(1001, 'server shutting down');
    this.wss?.close();
  }

  // Test hook: feed a raw connection (used by unit tests with a fake socket).
  acceptForTest(socket: RawSocket): Connection {
    const conn = new Connection(socket);
    this.connections.add(conn);
    return conn;
  }

  // Test hook: route a parsed frame through the full pipeline.
  async deliverForTest(conn: Connection, raw: string): Promise<void> {
    await this.onMessage(conn, Buffer.from(raw, 'utf8'), false);
  }
}
