/**
 * Tiny seeded PRNG for the PURE setup generators (chaos / daily rotation).
 *
 * Mirrors the engine's PRNG approach (FNV-1a seed → mulberry32) so the
 * generators are deterministic and JSON-free: same seed ⇒ identical draws. The
 * engine owns the *match* PRNG (`packages/engine/src/prng.ts`); this local copy
 * keeps `@nocturne/shared` free of an engine dependency while honoring the
 * project invariant that nothing here reads `Date.now`/`Math.random`.
 */

/** Opaque PRNG state — a single 32-bit unsigned integer. */
export type PrngState = number;

/** Hash a seed string into an initial 32-bit PRNG state (FNV-1a, deterministic). */
export function seedPrng(seed: string): PrngState {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Advance one step (mulberry32). Returns the next state and a float in [0, 1). */
export function nextFloat(state: PrngState): { state: PrngState; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a >>> 0, value };
}

/** Draw an integer in [0, n). For n <= 0 returns 0 without advancing. */
export function nextInt(state: PrngState, n: number): { state: PrngState; value: number } {
  if (n <= 0) return { state, value: 0 };
  const { state: s2, value } = nextFloat(state);
  return { state: s2, value: Math.floor(value * n) };
}

/** Pick one element from a non-empty array. Caller ensures the array is non-empty. */
export function pick<T>(state: PrngState, items: readonly T[]): { state: PrngState; value: T } {
  const { state: s2, value: idx } = nextInt(state, items.length);
  return { state: s2, value: items[idx] as T };
}

/** Fisher–Yates shuffle producing a NEW array (input untouched). */
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
