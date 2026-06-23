/**
 * Ranked award orchestration tests (ranked play). Drives `awardRankedRatings`
 * against a MemoryStore and asserts: ratings + ranked_results are written for
 * HUMANS ONLY (guests/bots excluded), games/wins bump correctly, and the
 * standing summary derives the rank from MMR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import { awardRankedRatings, buildRankedSummary, RANKED_MODE } from './award.js';
import type { MatchPlayerRecord } from '../db/types.js';

function player(id: string, outcome: string, seat: number): MatchPlayerRecord {
  return {
    userOrGuestId: id,
    seat,
    role: 'CITIZEN',
    faction: 'TOWN',
    outcome,
    survived: outcome === 'win',
    deathDay: null,
  };
}

describe('awardRankedRatings', () => {
  let store: MemoryStore;
  let seasonId: string;

  beforeEach(async () => {
    store = new MemoryStore();
    const season = await store.ensureCurrentSeason('Test Season');
    seasonId = season.id;
  });

  it('updates ratings + writes ranked_results for humans only (guests/bots excluded)', async () => {
    const players: MatchPlayerRecord[] = [
      player('user-alice', 'win', 0),
      player('user-bob', 'loss', 1),
      player('guest:carol', 'win', 2), // a guest: excluded
      player('guest:bot-1', 'loss', 3), // a backfill bot (guest id): excluded
    ];
    const deltas = await awardRankedRatings({ store, matchId: 'm1', players, seasonId });

    // Only the two registered humans got ratings.
    expect([...deltas.keys()].sort()).toEqual(['user-alice', 'user-bob']);

    const alice = await store.getRating('user-alice', RANKED_MODE, seasonId);
    const bob = await store.getRating('user-bob', RANKED_MODE, seasonId);
    expect(alice).not.toBeNull();
    expect(bob).not.toBeNull();
    expect(alice!.games).toBe(1);
    expect(alice!.wins).toBe(1);
    expect(bob!.games).toBe(1);
    expect(bob!.wins).toBe(0);
    expect(alice!.mmr).toBeGreaterThan(1500); // winner up
    expect(bob!.mmr).toBeLessThan(1500); // loser down

    // Guests/bots have no rating row.
    expect(await store.getRating('guest:carol', RANKED_MODE, seasonId)).toBeNull();
    expect(await store.getRating('guest:bot-1', RANKED_MODE, seasonId)).toBeNull();

    // ranked_results were written for the humans only.
    const aliceLedger = await store.getRankedResults('user-alice', 10);
    expect(aliceLedger).toHaveLength(1);
    expect(aliceLedger[0]!.matchId).toBe('m1');
    expect(aliceLedger[0]!.mode).toBe(RANKED_MODE);
    expect(aliceLedger[0]!.delta).toBeCloseTo(alice!.mmr - 1500, 6);
    expect(await store.getRankedResults('guest:carol', 10)).toHaveLength(0);
  });

  it('a solo human carried by bots moves only slightly (density dampening)', async () => {
    const players: MatchPlayerRecord[] = [
      player('user-solo', 'win', 0),
      player('guest:bot-1', 'loss', 1),
      player('guest:bot-2', 'loss', 2),
      player('guest:bot-3', 'loss', 3),
      player('guest:bot-4', 'loss', 4),
      player('guest:bot-5', 'loss', 5),
      player('guest:bot-6', 'loss', 6),
    ];
    const deltas = await awardRankedRatings({ store, matchId: 'm2', players, seasonId });
    const d = deltas.get('user-solo')!;
    expect(d).toBeGreaterThan(0);
    // Heavily dampened (density 1/7): well under a typical full-game swing.
    expect(d).toBeLessThan(30);
  });

  it('the ledger is idempotent on (match,user)', async () => {
    const players = [player('user-x', 'win', 0), player('user-y', 'loss', 1)];
    await awardRankedRatings({ store, matchId: 'm3', players, seasonId });
    await awardRankedRatings({ store, matchId: 'm3', players, seasonId });
    expect(await store.getRankedResults('user-x', 10)).toHaveLength(1);
  });
});

describe('buildRankedSummary', () => {
  it('derives the rank name from MMR and returns null when unrated', async () => {
    const store = new MemoryStore();
    const season = await store.ensureCurrentSeason('S');
    expect(await buildRankedSummary(store, 'nobody', season.id)).toBeNull();

    await store.upsertRating({
      userId: 'user-z',
      mode: RANKED_MODE,
      seasonId: season.id,
      mmr: 1750,
      rd: 120,
      vol: 0.06,
      games: 5,
      wins: 4,
      updatedAt: 0,
    });
    const summary = await buildRankedSummary(store, 'user-z', season.id);
    expect(summary).not.toBeNull();
    expect(summary!.mmr).toBe(1750);
    expect(summary!.rank).toBe('shadow'); // 1700+ ⇒ Shadow
    expect(summary!.rankName).toBe('Shadow');
    expect(summary!.games).toBe(5);
    expect(summary!.wins).toBe(4);
  });
});
