/**
 * Replay-integrity fingerprinting (BUILD_SPEC §9, goal 9).
 *
 * A finished match is fingerprinted with HMAC-SHA256 over a CANONICAL JSON
 * encoding of its replay-bearing core (setup, seed, per-seat results, the
 * ordered event log, and chat). The HMAC key is a server secret, so a fingerprint
 * cannot be forged by anyone without server access — it is the operator's proof
 * that a downloaded replay was produced by this server and not tampered with.
 *
 * Canonicalization sorts object keys recursively so the fingerprint is stable
 * across Postgres JSONB round-trips (JSONB does not preserve key order). Verify
 * a replay by recomputing the fingerprint over the same canonical core and
 * comparing in constant time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The replay-bearing fields fingerprinted. Volatile fields (timestamps, the
 * fingerprint itself) are excluded so verify-on-read is stable. */
export interface FingerprintInput {
  id: string;
  setupId: string;
  seed: string;
  outcome: string | null;
  players: {
    userOrGuestId: string;
    seat: number;
    role: string;
    faction: string;
    outcome: string;
    survived: boolean;
    deathDay: number | null;
  }[];
  events: { seq: number; phase: string; event: unknown }[];
  chat: { seq: number; channel: string; senderSeat: number | null; body: string }[];
}

/** Recursive canonical JSON: object keys sorted, arrays preserved in order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/** Build the stable canonical core from a match record. */
function core(input: FingerprintInput): unknown {
  return {
    id: input.id,
    setupId: input.setupId,
    seed: input.seed,
    outcome: input.outcome,
    players: [...input.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        userOrGuestId: p.userOrGuestId,
        seat: p.seat,
        role: p.role,
        faction: p.faction,
        outcome: p.outcome,
        survived: p.survived,
        deathDay: p.deathDay,
      })),
    events: [...input.events]
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ seq: e.seq, phase: e.phase, event: e.event })),
    chat: [...input.chat]
      .sort((a, b) => a.seq - b.seq)
      .map((c) => ({ seq: c.seq, channel: c.channel, senderSeat: c.senderSeat, body: c.body })),
  };
}

/** Compute the `sha256:<hex>` fingerprint of a match record. */
export function fingerprintMatch(input: FingerprintInput, secret: string): string {
  const canon = canonicalize(core(input));
  const mac = createHmac('sha256', secret).update(canon).digest('hex');
  return `sha256:${mac}`;
}

/** Constant-time verify that `expected` matches the recomputed fingerprint. */
export function verifyFingerprint(
  input: FingerprintInput,
  secret: string,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  const actual = fingerprintMatch(input, secret);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
