import { describe, it, expect } from 'vitest';
import {
  INITIAL_CLOCK_ESTIMATE,
  sampleOffset,
  updateEstimate,
  toServerTime,
  msRemaining,
  secondsRemaining,
  formatCountdown,
} from '../lib/clock.js';

describe('clock offset math (BUILD_SPEC §6.2)', () => {
  it('estimates offset at the round-trip midpoint', () => {
    // Local send 1000, recv 1100 (rtt 100, midpoint 1050). Server clock at
    // midpoint reported as 6050 ⇒ offset +5000.
    const { offsetMs, rttMs } = sampleOffset({ t0: 1000, t1: 1100, serverT: 6050 });
    expect(rttMs).toBe(100);
    expect(offsetMs).toBe(5000);
  });

  it('keeps the lowest-RTT sample', () => {
    let est = INITIAL_CLOCK_ESTIMATE;
    est = updateEstimate(est, { t0: 0, t1: 200, serverT: 1100 }); // rtt 200, offset 1000
    expect(est.offsetMs).toBe(1000);
    // A noisier sample (higher rtt) must not replace it.
    est = updateEstimate(est, { t0: 0, t1: 1000, serverT: 9999 });
    expect(est.offsetMs).toBe(1000);
    // A cleaner sample (lower rtt) replaces it.
    est = updateEstimate(est, { t0: 0, t1: 50, serverT: 2025 }); // rtt 50, offset 2000
    expect(est.offsetMs).toBe(2000);
    expect(est.rttMs).toBe(50);
  });

  it('converts local time to server time using the offset', () => {
    const est = updateEstimate(INITIAL_CLOCK_ESTIMATE, { t0: 0, t1: 0, serverT: 3000 });
    expect(toServerTime(1000, est)).toBe(4000);
  });

  it('computes remaining ms from a server deadline corrected by offset', () => {
    // Server is 5000ms ahead. endsAt (server) = 20000. local now = 12000 ⇒
    // serverNow = 17000 ⇒ 3000ms remain.
    const est = updateEstimate(INITIAL_CLOCK_ESTIMATE, { t0: 0, t1: 0, serverT: 5000 });
    expect(msRemaining(20000, 12000, est)).toBe(3000);
  });

  it('never returns negative remaining time', () => {
    const est = INITIAL_CLOCK_ESTIMATE;
    expect(msRemaining(1000, 9999, est)).toBe(0);
    expect(secondsRemaining(1000, 9999, est)).toBe(0);
  });

  it('rounds seconds up so a sub-second tail still shows', () => {
    const est = INITIAL_CLOCK_ESTIMATE;
    expect(secondsRemaining(1400, 1000, est)).toBe(1); // 400ms → ceil → 1
  });

  it('returns 0 remaining for a null deadline', () => {
    expect(msRemaining(null, 1000, INITIAL_CLOCK_ESTIMATE)).toBe(0);
  });

  it('formats countdowns as M:SS', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(150)).toBe('2:30');
  });
});
