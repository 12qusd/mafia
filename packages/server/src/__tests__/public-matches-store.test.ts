/**
 * Store-level checks for the public, FINISHED-only retention surfaces
 * (getRecentMatches / getPublicMatchSummary) against the NO_DB MemoryStore.
 *
 * LEAK SAFETY is the load-bearing assertion here: neither method may ever expose
 * a match whose ended_at is null (an in-progress game's roles must stay secret).
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import type { MatchPlayerRecord } from '../db/types.js';

const SEATS: MatchPlayerRecord[] = [
  { userOrGuestId: 'u-1', seat: 0, role: 'SHERIFF', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null },
  { userOrGuestId: 'g-2', seat: 1, role: 'GODFATHER', faction: 'MAFIA', outcome: 'loss', survived: false, deathDay: 3 },
];

/** Build a finished match record (ended_at set). */
function finished(id: string, endedAt: number, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    setupId: 'classic',
    config: {},
    seed: 'seed',
    startedAt: endedAt - 1000,
    endedAt,
    outcome: 'TOWN',
    serverBuild: 'test',
    fingerprint: 'fp',
    mode: 'casual',
    players: SEATS,
    events: [],
    chat: [],
    ...extra,
  };
}

describe('getRecentMatches (FINISHED-only, newest-first, with counts)', () => {
  it('returns only finished matches, newest first, with correct player counts', async () => {
    const store = new MemoryStore();
    await store.writeMatch(finished('a', 1000) as never);
    await store.writeMatch(finished('b', 3000) as never);
    await store.writeMatch(finished('c', 2000) as never);
    // An in-progress match (ended_at null) must NOT appear.
    store.setMatchForTest({ ...finished('live', 9999), endedAt: null } as never);

    const recent = await store.getRecentMatches(10);
    expect(recent.map((m) => m.id)).toEqual(['b', 'c', 'a']); // newest endedAt first
    expect(recent.every((m) => m.id !== 'live')).toBe(true); // leak-safety
    expect(recent[0]!.players).toBe(2);
    expect(recent[0]!.mode).toBe('casual');
    expect(recent[0]!.endedAt).toBe(3000);
  });

  it('caps the limit at 30 and never below 1', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 40; i++) await store.writeMatch(finished(`m${i}`, 1000 + i) as never);
    expect((await store.getRecentMatches(100)).length).toBe(30);
    expect((await store.getRecentMatches(0)).length).toBe(1);
    expect((await store.getRecentMatches(5)).length).toBe(5);
  });

  it('is empty with no finished matches', async () => {
    const store = new MemoryStore();
    store.setMatchForTest({ ...finished('live', 1), endedAt: null } as never);
    expect(await store.getRecentMatches(8)).toEqual([]);
  });
});

describe('getPublicMatchSummary (FINISHED-only, ordered seats)', () => {
  it('returns null for an unknown id', async () => {
    const store = new MemoryStore();
    expect(await store.getPublicMatchSummary('nope')).toBeNull();
  });

  it('returns null for an IN-PROGRESS match (ended_at null) — LEAK SAFETY', async () => {
    const store = new MemoryStore();
    store.setMatchForTest({ ...finished('live', 9999), endedAt: null } as never);
    expect(await store.getPublicMatchSummary('live')).toBeNull();
  });

  it('returns the seat roster (ordered by seat) for a finished match', async () => {
    const store = new MemoryStore();
    store.setUsernameForTest('u-1', 'Capone'); // account seat resolves a name
    await store.writeMatch(finished('done', 5000) as never);

    const summary = await store.getPublicMatchSummary('done');
    expect(summary).not.toBeNull();
    expect(summary!.id).toBe('done');
    expect(summary!.endedAt).toBe(5000);
    expect(summary!.outcome).toBe('TOWN');
    expect(summary!.seats.map((s) => s.seat)).toEqual([0, 1]);
    // Account seat carries the username; guest seat is null.
    expect(summary!.seats[0]!.name).toBe('Capone');
    expect(summary!.seats[1]!.name).toBeNull();
    expect(summary!.seats[0]!.role).toBe('SHERIFF');
  });

  it('never returns a match whose ended_at is null (explicit invariant)', async () => {
    const store = new MemoryStore();
    // Insert several in-progress matches; none must ever be summarised.
    for (const id of ['x', 'y', 'z']) {
      store.setMatchForTest({ ...finished(id, 1), endedAt: null } as never);
      expect(await store.getPublicMatchSummary(id)).toBeNull();
    }
  });
});
