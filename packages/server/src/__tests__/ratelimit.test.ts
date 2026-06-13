/**
 * Rate-limit tests (BUILD_SPEC §6.4, §11.5, §12.4).
 */

import { describe, it, expect } from 'vitest';
import { SlidingWindow, MinInterval, ChatLimiter } from '../ratelimit.js';
import {
  SOCKET_RATE_MAX_MESSAGES,
  CHAT_RATE_MAX_MESSAGES,
  WHISPER_MIN_INTERVAL_MS,
} from '@nocturne/shared';
import { Gateway } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';

describe('rate limiters', () => {
  it('SlidingWindow allows up to max then blocks within the window', () => {
    let t = 1000;
    const w = new SlidingWindow(3, 1000, () => t);
    expect(w.tryAcquire()).toBe(true);
    expect(w.tryAcquire()).toBe(true);
    expect(w.tryAcquire()).toBe(true);
    expect(w.tryAcquire()).toBe(false);
    t += 1001; // window passed
    expect(w.tryAcquire()).toBe(true);
  });

  it('MinInterval enforces the minimum gap', () => {
    let t = 0;
    const m = new MinInterval(WHISPER_MIN_INTERVAL_MS, () => t);
    expect(m.tryAcquire()).toBe(true);
    t += 1000;
    expect(m.tryAcquire()).toBe(false);
    t += WHISPER_MIN_INTERVAL_MS;
    expect(m.tryAcquire()).toBe(true);
  });

  it('ChatLimiter is per-channel', () => {
    const t = 0;
    const c = new ChatLimiter(() => t);
    for (let i = 0; i < CHAT_RATE_MAX_MESSAGES; i++) expect(c.tryChat('day')).toBe(true);
    expect(c.tryChat('day')).toBe(false);
    // Different channel has its own budget.
    expect(c.tryChat('mafia')).toBe(true);
  });

  it('connection-level limit replies rate_limited over the socket cap (§11.5)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);
    // Send well over the socket cap of valid ping frames.
    for (let i = 0; i < SOCKET_RATE_MAX_MESSAGES + 5; i++) {
      await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'ping', t: i }));
    }
    const rl = sock.ofType('error').filter((e) => (e as { code?: string }).code === 'rate_limited');
    expect(rl.length).toBeGreaterThan(0);
  });
});
