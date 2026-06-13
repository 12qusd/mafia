/**
 * Seeded PRNG (BUILD_SPEC §2.2, §4.3).
 *
 * The engine reads no wall-clock time and no unseeded randomness. ALL randomness
 * flows from this one deterministic generator, seeded from the match seed string.
 *
 * Algorithm: mulberry32 over a 32-bit state, seeded by hashing the seed string
 * with a small FNV-1a-style mix. The PRNG state lives inside {@link GameState}
 * as a plain number so the whole engine stays JSON-serializable and replayable
 * (same seed + same ordered event log ⇒ byte-identical states).
 *
 * Pure: every function returns a new state rather than mutating in place.
 */

/** Opaque PRNG state — a single 32-bit unsigned integer. */
export type PrngState = number;

/** Hash a seed string into an initial 32-bit PRNG state (deterministic). */
export function seedPrng(seed: string): PrngState {
  // FNV-1a 32-bit hash over the UTF-16 code units of the seed.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // h *= 16777619, kept in 32-bit space.
    h = Math.imul(h, 0x01000193);
  }
  // Avoid a zero state (mulberry32 from 0 is fine, but normalize to unsigned).
  return h >>> 0;
}

/**
 * Advance the PRNG one step. Returns the next state and a float in [0, 1).
 * (mulberry32.)
 */
export function nextFloat(state: PrngState): { state: PrngState; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a >>> 0, value };
}

/**
 * Draw an integer in [0, n). Returns the advanced state and the value.
 * For n <= 0 returns 0 without advancing (defensive; callers guard).
 */
export function nextInt(state: PrngState, n: number): { state: PrngState; value: number } {
  if (n <= 0) return { state, value: 0 };
  const { state: s2, value } = nextFloat(state);
  return { state: s2, value: Math.floor(value * n) };
}

/**
 * Pick one element from a non-empty array. Returns the advanced state and the
 * chosen element. Caller must ensure the array is non-empty.
 */
export function pick<T>(state: PrngState, items: readonly T[]): { state: PrngState; value: T } {
  const { state: s2, value: idx } = nextInt(state, items.length);
  // Safe by precondition (items non-empty); noUncheckedIndexedAccess guard:
  const value = items[idx] as T;
  return { state: s2, value };
}

/**
 * Fisher–Yates shuffle producing a new array (does not mutate input). Returns
 * the advanced state and the shuffled copy.
 */
export function shuffle<T>(state: PrngState, items: readonly T[]): { state: PrngState; value: T[] } {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.state;
    const j = r.value;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return { state: s, value: out };
}
