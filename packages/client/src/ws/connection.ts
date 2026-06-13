/**
 * WebSocket connection manager (BUILD_SPEC §8, §9).
 *
 * Single connection per app. Responsibilities:
 *  - hello/welcome handshake: send `hello {token?, protocolVersion}` on open;
 *    the server replies `welcome` (with an optional resume snapshot, §8) or an
 *    `error`.
 *  - auto-reconnect with exponential backoff + jitter; on resume the `welcome`
 *    snapshot rehydrates the store.
 *  - clock-offset estimation: periodic `ping {t}`; on `pong {t}` we fold a
 *    round-trip sample into the store's clock estimate (§6.2).
 *  - force_update: surface a reload prompt (the store flips to `force_update`).
 *  - every inbound frame is zod-validated via `safeParseServerMessage`; unknown
 *    or invalid frames are logged and ignored (§13 resilience).
 *
 * All outbound messages are constructed from shared types and validated before
 * send (defence in depth; the server validates authoritatively).
 */

import {
  PROTOCOL_VERSION,
  safeParseServerMessage,
  ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { loadToken, saveToken } from '../lib/storage.js';

/** Ping cadence for clock sampling (ms). */
const PING_INTERVAL_MS = 5_000;
/** Backoff bounds for reconnect. */
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 15_000;

/** Resolve the WS URL: same origin, `/ws` path, ws/wss per page protocol. */
function wsUrl(): string {
  const loc = globalThis.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

class Connection {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = BACKOFF_MIN_MS;
  private closedByUser = false;
  private hadConnection = false;
  /** Local send time of the outstanding ping, keyed by its `t` value. */
  private pingSends = new Map<number, number>();

  /** Open the connection (idempotent). */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUser = false;
    const store = useStore.getState();
    store.setConnection(this.hadConnection ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.backoff = BACKOFF_MIN_MS;
      this.hadConnection = true;
      useStore.getState().setConnection('authenticating');
      this.sendHello();
      this.startPing();
    };

    socket.onmessage = (ev) => this.onFrame(ev.data);

    socket.onclose = () => {
      this.stopPing();
      this.ws = null;
      if (this.closedByUser) {
        useStore.getState().setConnection('closed');
        return;
      }
      if (useStore.getState().connection !== 'force_update') {
        useStore.getState().setConnection('reconnecting');
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose will follow; nothing extra to do.
    };
  }

  /**
   * Re-establish the session after the stored token changed (guest/login/
   * register). The live socket is still bound to whatever identity it sent in
   * its first `hello` (often a throwaway auto-minted guest), so we drop it and
   * open a fresh socket that re-sends `hello` with the new token — the server
   * then binds the session to the intended identity and replies `welcome`.
   */
  reauth(): void {
    const sock = this.ws;
    if (sock) {
      // Detach handlers so the old socket's close doesn't trigger a competing
      // reconnect, then close it cleanly.
      this.ws = null;
      this.stopPing();
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  /** Close intentionally (logout / navigate away). */
  disconnect(): void {
    this.closedByUser = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    useStore.getState().setConnection('closed');
  }

  /** Send a client message (validated against the shared schema first). */
  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const parsed = ClientMessageSchema.safeParse(msg);
    if (!parsed.success) {
      // Programmer error — never put an invalid frame on the wire.
      console.error('[ws] refusing to send invalid client message', parsed.error.issues);
      return;
    }
    this.ws.send(JSON.stringify(parsed.data));
  }

  private sendHello(): void {
    const token = loadToken();
    this.send({
      v: PROTOCOL_VERSION,
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      ...(token ? { token } : {}),
    });
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      console.warn('[ws] dropped non-JSON frame');
      return;
    }
    const parsed = safeParseServerMessage(json);
    if (!parsed.success) {
      // Unknown type or failed validation — ignore gracefully (§13 resilience).
      console.warn('[ws] dropped unrecognized server frame', parsed.error.issues?.[0]?.message);
      return;
    }
    this.handle(parsed.data);
  }

  private handle(msg: ServerMessage): void {
    const store = useStore.getState();

    // Side-channel handling before the pure reducer for a few message kinds.
    if (msg.type === 'pong') {
      const t0 = this.pingSends.get(msg.t);
      if (t0 !== undefined) {
        this.pingSends.delete(msg.t);
        store.addClockSample({ t0, t1: Date.now(), serverT: msg.t });
      }
      return; // pong carries no store state.
    }

    if (msg.type === 'welcome') {
      // Persist any token the server hands back over the resume path.
      if (msg.userId) saveToken(msg.userId);
    }

    store.ingest(msg);
  }

  private startPing(): void {
    this.stopPing();
    const tick = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const t = Date.now();
      this.pingSends.set(t, t);
      // Bound the outstanding-ping map.
      if (this.pingSends.size > 16) {
        const oldest = this.pingSends.keys().next().value;
        if (oldest !== undefined) this.pingSends.delete(oldest);
      }
      this.send({ v: PROTOCOL_VERSION, type: 'ping', t });
    };
    tick();
    this.pingTimer = setInterval(tick, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const jitter = Math.random() * this.backoff * 0.3;
    const delay = Math.min(this.backoff, BACKOFF_MAX_MS) + jitter;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      this.connect();
    }, delay);
  }
}

/** The singleton connection. */
export const conn = new Connection();
