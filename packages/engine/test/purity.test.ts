import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Determinism guard (BUILD_SPEC §4.3): the engine must never read wall-clock time
 * or unseeded randomness. We statically scan `src/` for the forbidden tokens.
 * This complements the engine-local ESLint `no-restricted-syntax` rule and is
 * CI-gating on its own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

const FORBIDDEN: { pattern: RegExp; name: string }[] = [
  { pattern: /\bDate\.now\b/, name: 'Date.now' },
  { pattern: /\bnew Date\b/, name: 'new Date' },
  { pattern: /\bMath\.random\b/, name: 'Math.random' },
  { pattern: /\bperformance\.now\b/, name: 'performance.now' },
  { pattern: /\bprocess\.hrtime\b/, name: 'process.hrtime' },
  { pattern: /\bcrypto\.randomUUID\b/, name: 'crypto.randomUUID' },
];

/** Remove block and line comments so prose mentioning the tokens is ignored. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('§4.3 engine purity / determinism guard', () => {
  it('src contains no wall-clock or unseeded-randomness calls', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const { pattern, name } of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
