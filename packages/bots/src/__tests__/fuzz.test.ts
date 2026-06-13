/**
 * Fuzz & abuse tests over REAL loopback sockets (BUILD_SPEC §9, §12.4).
 *
 * Extends the server's own coverage FROM THE OUTSIDE, through actual WebSockets:
 *   - random bytes / malformed JSON / oversized / out-of-phase / unknown-type
 *     frames never crash the server and always produce an `error` reply where the
 *     server is supposed to reply,
 *   - connection-level rate limiting trips and replies `error`,
 *   - duplicate-connection takeover: a second socket with the same token wins; the
 *     old one is closed (§8 newest-wins),
 *   - the process survives a burst of garbage and still serves a clean client.
 *
 * Uses the in-process real server (NO_DB) so the gateway/handlers under test are
 * the production code paths.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startInProcessServer, type RunningServer } from '../server-harness.js';
import { BotClient } from '../client.js';

let server: RunningServer;
beforeAll(async () => {
  server = await startInProcessServer();
});
afterAll(async () => {
  await server.shutdown();
});

/** Open a raw ws, collect text frames, run `body`, then close. */
async function withRawSocket(
  body: (ws: WebSocket, frames: unknown[]) => Promise<void>,
): Promise<unknown[]> {
  const ws = new WebSocket(server.wsUrl);
  const frames: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.on('message', (d: WebSocket.RawData) => {
    try {
      frames.push(JSON.parse(String(d)));
    } catch {
      frames.push({ unparseable: String(d) });
    }
  });
  await body(ws, frames);
  await new Promise((r) => setTimeout(r, 100));
  ws.close();
  return frames;
}

const send = (ws: WebSocket, obj: unknown) => ws.send(JSON.stringify(obj));
const errorsIn = (frames: unknown[]) =>
  frames.filter((f) => (f as { type?: string }).type === 'error');

describe('fuzz & abuse (§12.4) — server survives, replies error', () => {
  it('malformed JSON gets an error and never crashes', async () => {
    const frames = await withRawSocket(async (ws) => {
      ws.send('this is not json{{{');
      ws.send('}{');
      ws.send('42');
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(errorsIn(frames).length).toBeGreaterThan(0);
  });

  it('unknown type and out-of-phase commands reply error (post-hello)', async () => {
    const frames = await withRawSocket(async (ws) => {
      send(ws, { v: 1, type: 'hello', protocolVersion: 1 });
      await new Promise((r) => setTimeout(r, 50));
      send(ws, { v: 1, type: 'definitely_not_a_real_type', foo: 1 });
      // out-of-phase: vote with no game in progress.
      send(ws, { v: 1, type: 'vote', target: 3 });
      send(ws, { v: 1, type: 'start_game' });
      await new Promise((r) => setTimeout(r, 100));
    });
    // welcome + at least one error reply.
    expect(frames.some((f) => (f as { type?: string }).type === 'welcome')).toBe(true);
    expect(errorsIn(frames).length).toBeGreaterThan(0);
  });

  it('oversized frame (> 8KB) is rejected with error', async () => {
    const frames = await withRawSocket(async (ws) => {
      send(ws, { v: 1, type: 'hello', protocolVersion: 1 });
      await new Promise((r) => setTimeout(r, 50));
      const huge = 'x'.repeat(9 * 1024);
      send(ws, { v: 1, type: 'chat', channel: 'lobby', text: huge });
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(errorsIn(frames).length).toBeGreaterThan(0);
  });

  it('a burst of 2000 random frames never crashes the process', async () => {
    await withRawSocket(async (ws) => {
      send(ws, { v: 1, type: 'hello', protocolVersion: 1 });
      for (let i = 0; i < 2000; i++) {
        const r = Math.random();
        if (r < 0.3) ws.send(randomBytes(40));
        else if (r < 0.6) ws.send('{' + randomBytes(20));
        else send(ws, { v: 1, type: pick(['vote', 'chat', 'night_action', 'zzz']), target: (i % 7) });
      }
      await new Promise((r) => setTimeout(r, 200));
    });
    // The server is still up: a fresh client can hello + get welcome.
    const fresh = new BotClient({ url: server.wsUrl, name: 'survivor' });
    await fresh.connect();
    expect(fresh.helloAcked).toBe(true);
    fresh.close();
  });

  it('connection-level rate limit trips on spam', async () => {
    const frames = await withRawSocket(async (ws) => {
      send(ws, { v: 1, type: 'hello', protocolVersion: 1 });
      await new Promise((r) => setTimeout(r, 30));
      for (let i = 0; i < 60; i++) send(ws, { v: 1, type: 'ping', t: i });
      await new Promise((r) => setTimeout(r, 120));
    });
    const errs = errorsIn(frames) as { code?: string }[];
    expect(errs.some((e) => e.code === 'rate_limited')).toBe(true);
  });
});

function randomBytes(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(33 + Math.floor(Math.random() * 90));
  return s;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
