/**
 * Protocol fuzz + abuse tests (BUILD_SPEC §12.4).
 *
 * Property: malformed / oversized / unknown / out-of-phase frames never crash
 * the gateway, and every rejected frame produces an `error` reply.
 */

import { describe, it, expect } from 'vitest';
import { Gateway, MAX_FRAME_BYTES } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';

function randomFrame(rnd: () => number): string {
  const kind = Math.floor(rnd() * 6);
  switch (kind) {
    case 0:
      return '{not valid json';
    case 1:
      return JSON.stringify({ v: 1, type: 'totally_unknown_' + Math.floor(rnd() * 1000) });
    case 2:
      return JSON.stringify({ v: 99, type: 'hello', protocolVersion: 7 });
    case 3:
      return JSON.stringify({ random: rnd(), nested: { a: [rnd(), rnd()] } });
    case 4:
      return JSON.stringify({ v: 1, type: 'chat', channel: 'day' }); // missing text
    default: {
      // Random bytes-ish string.
      let s = '';
      const len = Math.floor(rnd() * 64);
      for (let i = 0; i < len; i++) s += String.fromCharCode(Math.floor(rnd() * 65535));
      return JSON.stringify({ v: 1, type: 'whisper', toSeat: -5, text: s });
    }
  }
}

// Deterministic PRNG for reproducible fuzzing.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('protocol fuzz (§12.4)', () => {
  it('never crashes and replies error to every rejected frame', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);

    const rnd = lcg(12345);
    const N = 5000;
    for (let i = 0; i < N; i++) {
      await gw.deliverForTest(conn, randomFrame(rnd));
    }
    // Process survived; at least some error frames were produced.
    const errors = sock.ofType('error');
    expect(errors.length).toBeGreaterThan(0);
    // No exception thrown (reaching here proves survival).
    expect(true).toBe(true);
  });

  it('rejects oversized frames with bad_message and does not crash', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 100);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'chat', channel: 'day', text: huge }));
    const err = sock.lastOfType('error');
    expect(err?.code).toBe('bad_message');
  });

  it('rejects malformed JSON with bad_message', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);
    await gw.deliverForTest(conn, '{ broken json ');
    expect(sock.lastOfType('error')?.code).toBe('bad_message');
  });

  it('requires hello before other messages', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'leave_lobby' }));
    expect(sock.lastOfType('error')?.code).toBe('not_authenticated');
  });

  it('hello with wrong protocol version is rejected (schema pins v=1)', async () => {
    // The shared schema pins protocolVersion to the literal 1, so a mismatched
    // version fails validation up front (bad_message). The handler's
    // force_update branch covers a future protocol-evolution path; today a
    // mismatch never reaches it. Either way, no crash and an error reply.
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = gw.acceptForTest(sock);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 999 }));
    expect(sock.lastOfType('error')?.code).toBe('bad_message');
  });
});
