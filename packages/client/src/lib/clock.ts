/**
 * Client/server clock-offset estimation and countdown math (BUILD_SPEC §6.2).
 *
 * The server never trusts client clocks. Phase deadlines arrive as server epoch
 * ms (`phase_change.endsAt`); the client renders countdowns by converting that
 * to local time using an estimated offset between the two clocks.
 *
 * Offset is estimated from ping/pong round trips. On `ping` we record the local
 * send time `t0`; on `pong` (which echoes `t`) we sample at local time `t1` and
 * estimate the server clock at the midpoint of the round trip. We keep the
 * sample with the *lowest round-trip time* (least jitter), the standard
 * SNTP-style heuristic.
 *
 * Everything here is pure and unit-tested (§13.2 tests requirement).
 */

/** A single round-trip clock sample. */
export interface ClockSample {
  /** Local time the ping was sent (ms). */
  t0: number;
  /** Local time the pong was received (ms). */
  t1: number;
  /** Server time echoed in the pong (`pong.t`, ms). */
  serverT: number;
}

/** Estimator state: the best sample so far. */
export interface ClockEstimate {
  /** offset = serverClock - localClock (ms). Add to local time to get server time. */
  offsetMs: number;
  /** Round-trip time of the sample this offset came from (ms). */
  rttMs: number;
  /** Whether any sample has been taken. */
  sampled: boolean;
}

/** Initial estimate: zero offset, no sample. */
export const INITIAL_CLOCK_ESTIMATE: ClockEstimate = {
  offsetMs: 0,
  rttMs: Number.POSITIVE_INFINITY,
  sampled: false,
};

/**
 * Compute the offset implied by a single sample.
 *
 * The pong's `serverT` is the server clock at *some* point during the round
 * trip. Assuming symmetric latency, that point is the local midpoint
 * (t0 + t1) / 2. So offset = serverT - midpointLocal.
 */
export function sampleOffset(s: ClockSample): { offsetMs: number; rttMs: number } {
  const rttMs = Math.max(0, s.t1 - s.t0);
  const midpointLocal = (s.t0 + s.t1) / 2;
  return { offsetMs: s.serverT - midpointLocal, rttMs };
}

/**
 * Fold a new sample into the running estimate, keeping the lowest-RTT sample.
 * Pure: returns a new estimate.
 */
export function updateEstimate(prev: ClockEstimate, s: ClockSample): ClockEstimate {
  const { offsetMs, rttMs } = sampleOffset(s);
  if (!prev.sampled || rttMs < prev.rttMs) {
    return { offsetMs, rttMs, sampled: true };
  }
  return prev;
}

/** Convert a local epoch-ms instant to estimated server time. */
export function toServerTime(localMs: number, est: ClockEstimate): number {
  return localMs + est.offsetMs;
}

/**
 * Milliseconds remaining until a server `endsAt` deadline, given the current
 * local clock and the offset estimate. Never negative.
 *
 *   serverNow = localNow + offset
 *   remaining = endsAt - serverNow
 */
export function msRemaining(endsAt: number | null, localNow: number, est: ClockEstimate): number {
  if (endsAt === null) return 0;
  const serverNow = toServerTime(localNow, est);
  return Math.max(0, endsAt - serverNow);
}

/** Whole seconds remaining (rounded up so a 0.4 s tail still shows "1"). */
export function secondsRemaining(
  endsAt: number | null,
  localNow: number,
  est: ClockEstimate,
): number {
  return Math.ceil(msRemaining(endsAt, localNow, est) / 1000);
}

/** Format seconds as M:SS for the countdown banner. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
