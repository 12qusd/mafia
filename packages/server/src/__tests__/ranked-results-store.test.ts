/**
 * Store contract for writeRankedResults: it must IGNORE an already-written
 * (match, user) pair, whether the batch comes in one call or several. The
 * PgStore now writes the whole batch in one multi-row INSERT with
 * `ON CONFLICT (match_id, user_id) DO NOTHING`; this test pins the observable
 * dedup contract that BOTH stores satisfy (exercised here on MemoryStore, which
 * NO_DB/CI can run; the PgStore equivalent needs a live Postgres smoke test).
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import type { RankedResultInput } from '../db/types.js';

function row(matchId: string, userId: string, delta = 5): RankedResultInput {
  return {
    matchId,
    userId,
    mode: 'ranked',
    mmrBefore: 1500,
    mmrAfter: 1500 + delta,
    rdBefore: 60,
    rdAfter: 58,
    delta,
  };
}

describe('writeRankedResults dedupe', () => {
  it('writes a multi-row batch once', async () => {
    const store = new MemoryStore();
    await store.writeRankedResults([row('m1', 'u1'), row('m1', 'u2'), row('m1', 'u3')]);
    expect(await store.getRankedResults('u1', 50)).toHaveLength(1);
    expect(await store.getRankedResults('u2', 50)).toHaveLength(1);
    expect(await store.getRankedResults('u3', 50)).toHaveLength(1);
  });

  it('ignores an already-written (match, user) on a re-run', async () => {
    const store = new MemoryStore();
    await store.writeRankedResults([row('m1', 'u1', 5)]);
    // Re-running the same match (e.g. a retried match-end write) must NOT add a
    // second row for the same (match, user) — the first delta stands.
    await store.writeRankedResults([row('m1', 'u1', 99), row('m1', 'u2', 7)]);
    const u1 = await store.getRankedResults('u1', 50);
    expect(u1).toHaveLength(1);
    expect(u1[0]!.delta).toBe(5); // the original write was preserved
    expect(await store.getRankedResults('u2', 50)).toHaveLength(1);
  });

  it('handles an empty batch as a no-op', async () => {
    const store = new MemoryStore();
    await store.writeRankedResults([]);
    expect(await store.getRankedResults('u1', 50)).toHaveLength(0);
  });
});
