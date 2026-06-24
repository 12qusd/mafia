/**
 * Ranked-lifecycle store state against the NO_DB MemoryStore (ranked-progression
 * depth). MemoryStore is guests-only, so these exercise the new Store methods at
 * the store level with synthetic user ids: season rollover (close old + open new
 * + soft-reset/archive ratings), rank position ordering, leaderboard pagination
 * bounds, and the placements threshold. The PgStore mirrors the same contract.
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import { RANKED_MODE } from '../ranked/award.js';
import { SEASON_MEAN, SEASON_CARRY, SEASON_RESET_RD, DEFAULT_VOL } from '@nocturne/shared';

function rate(store: MemoryStore, userId: string, seasonId: string, mmr: number, games = 10) {
  return store.upsertRating({
    userId,
    mode: RANKED_MODE,
    seasonId,
    mmr,
    rd: 80,
    vol: 0.05,
    games,
    wins: Math.floor(games / 2),
    updatedAt: 0,
  });
}

describe('season rollover', () => {
  it('closes the old season, opens a new current one, and archives + soft-resets ratings', async () => {
    const store = new MemoryStore();
    const s1 = await store.ensureCurrentSeason('Season 1');
    await rate(store, 'don', s1.id, 2300);
    await rate(store, 'mid', s1.id, 1500);
    await rate(store, 'low', s1.id, 1100);

    const s2 = await store.rolloverSeason('Season 2');
    expect(s2.isCurrent).toBe(true);
    expect(s2.id).not.toBe(s1.id);
    expect((await store.getCurrentSeason())!.id).toBe(s2.id);

    // Old season is closed + archived (its ratings remain under its season id).
    const seasons = await store.getSeasons(10);
    const old = seasons.find((s) => s.id === s1.id)!;
    expect(old.isCurrent).toBe(false);
    expect(old.endedAt).not.toBeNull();
    expect((await store.getRating('don', RANKED_MODE, s1.id))!.mmr).toBe(2300); // archived intact

    // New-season ratings are soft-reset (pulled toward the mean, RD widened,
    // games/wins zeroed for re-placement).
    const donNew = (await store.getRating('don', RANKED_MODE, s2.id))!;
    expect(donNew.mmr).toBeCloseTo(SEASON_MEAN + (2300 - SEASON_MEAN) * SEASON_CARRY, 6);
    expect(donNew.rd).toBe(SEASON_RESET_RD);
    expect(donNew.vol).toBe(DEFAULT_VOL);
    expect(donNew.games).toBe(0);
    expect(donNew.wins).toBe(0);
    // Relative ordering preserved across the reset.
    const lowNew = (await store.getRating('low', RANKED_MODE, s2.id))!;
    expect(donNew.mmr).toBeGreaterThan(lowNew.mmr);
  });

  it('getSeasons returns newest first and includes the current', async () => {
    const store = new MemoryStore();
    await store.ensureCurrentSeason('Season 1');
    await store.rolloverSeason('Season 2');
    const seasons = await store.getSeasons(10);
    expect(seasons[0]!.name).toBe('Season 2');
    expect(seasons[0]!.isCurrent).toBe(true);
    expect(seasons[1]!.name).toBe('Season 1');
  });
});

describe('getRankPosition', () => {
  it('is 1-based by descending mmr and null for an unrated user', async () => {
    const store = new MemoryStore();
    const s = await store.ensureCurrentSeason('S');
    await rate(store, 'top', s.id, 2000);
    await rate(store, 'mid', s.id, 1700);
    await rate(store, 'bot', s.id, 1400);

    expect(await store.getRankPosition('top', RANKED_MODE, s.id)).toBe(1);
    expect(await store.getRankPosition('mid', RANKED_MODE, s.id)).toBe(2);
    expect(await store.getRankPosition('bot', RANKED_MODE, s.id)).toBe(3);
    expect(await store.getRankPosition('nobody', RANKED_MODE, s.id)).toBeNull();
  });
});

describe('leaderboard pagination', () => {
  it('pages the board in mmr order with a stable total, clamped bounds', async () => {
    const store = new MemoryStore();
    const s = await store.ensureCurrentSeason('S');
    // 25 players with descending mmr.
    for (let i = 0; i < 25; i++) await rate(store, `u${String(i).padStart(2, '0')}`, s.id, 2000 - i);

    expect(await store.getRatingCount(RANKED_MODE, s.id)).toBe(25);

    const page0 = await store.getRatingLeaderboardPage(RANKED_MODE, s.id, 0, 10);
    expect(page0).toHaveLength(10);
    expect(page0[0]!.mmr).toBe(2000); // highest first
    expect(page0[9]!.mmr).toBe(1991);

    const page2 = await store.getRatingLeaderboardPage(RANKED_MODE, s.id, 20, 10);
    expect(page2).toHaveLength(5); // only 5 left on the last page
    expect(page2[0]!.mmr).toBe(1980);

    // Offset past the end → empty.
    const past = await store.getRatingLeaderboardPage(RANKED_MODE, s.id, 100, 10);
    expect(past).toHaveLength(0);
  });
});
