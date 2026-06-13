/**
 * Tiny deterministic PRNG for bot policies and the fast simulator.
 *
 * Bots must be reproducible from a seed (BUILD_SPEC §12.2, §12.5: "deterministic
 * enough for CI; use seeds"). This is NOT the engine PRNG — it only drives bot
 * decisions, never game resolution — so a simple mulberry32 is sufficient.
 */

/** A 32-bit string hash (FNV-1a-ish) to turn a seed string into a uint seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: fast, seedable, good enough for bot decisions. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
