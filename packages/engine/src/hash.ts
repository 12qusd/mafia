/**
 * Deterministic state hashing (BUILD_SPEC §12.1 determinism property test).
 *
 * GameState is plain JSON data, so a canonical JSON serialization with sorted
 * object keys yields a stable string; we hash it with FNV-1a (64-bit, hex). Two
 * states with identical content hash identically regardless of key insertion
 * order.
 */

import type { GameState } from './state.js';

/** Canonical JSON: object keys sorted recursively. */
function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a 64-bit hash, hex string (BigInt for exactness). */
function fnv1a64(str: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Stable content hash of a game state. */
export function hashState(state: GameState): string {
  return fnv1a64(canonical(state));
}
