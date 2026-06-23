/**
 * Match → MMR model tests (ranked play crux). Pure: winners gain / losers lose,
 * bot-density dampening, solo-vs-bots tiny delta, the opposing-average target.
 */

import { describe, it, expect } from 'vitest';
import { rateMatch, BOT_BASELINE_MMR, type RankedSeatInput } from './rate.js';
import { DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type Glicko } from '@nocturne/shared';

const base: Glicko = { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };

function seat(userId: string, outcome: string, rating: Glicko = base): RankedSeatInput {
  return { userId, outcome, rating };
}

describe('rateMatch: winners gain, losers lose', () => {
  it('an all-human game moves winners up and losers down', () => {
    const humans = [seat('w1', 'win'), seat('w2', 'win'), seat('l1', 'loss'), seat('l2', 'loss')];
    const results = rateMatch(humans, 4); // density 1.0 (all human)
    const byId = new Map(results.map((r) => [r.userId, r]));
    expect(byId.get('w1')!.delta).toBeGreaterThan(0);
    expect(byId.get('w2')!.delta).toBeGreaterThan(0);
    expect(byId.get('l1')!.delta).toBeLessThan(0);
    expect(byId.get('l2')!.delta).toBeLessThan(0);
    // The won flag tracks the outcome.
    expect(byId.get('w1')!.won).toBe(true);
    expect(byId.get('l1')!.won).toBe(false);
  });

  it('a non-win outcome (draw/left) is treated as a loser', () => {
    const results = rateMatch([seat('a', 'win'), seat('b', 'draw'), seat('c', 'left')], 3);
    const byId = new Map(results.map((r) => [r.userId, r]));
    expect(byId.get('a')!.won).toBe(true);
    expect(byId.get('b')!.won).toBe(false);
    expect(byId.get('c')!.won).toBe(false);
    expect(byId.get('b')!.delta).toBeLessThan(0);
  });
});

describe('rateMatch: bot-heavy dampening (humanDensity)', () => {
  it('a 1-human / 6-bot game barely moves MMR vs an all-human win', () => {
    const lonelyWin = rateMatch([seat('solo', 'win')], 7); // density 1/7 ≈ 0.14
    const denseWin = rateMatch([seat('a', 'win'), seat('b', 'loss')], 2); // density 1.0
    const soloDelta = Math.abs(lonelyWin[0]!.delta);
    const denseDelta = Math.abs(denseWin.find((r) => r.userId === 'a')!.delta);
    expect(soloDelta).toBeGreaterThan(0); // still moves
    expect(soloDelta).toBeLessThan(denseDelta); // but far less than a full game
    // Roughly proportional to density (≈ 1/7 of the same matchup, give or take
    // the different opponent — here just assert it is a small fraction).
    expect(soloDelta).toBeLessThan(denseDelta * 0.5);
  });

  it('delta scales monotonically with human density for the same matchup', () => {
    const win2of2 = rateMatch([seat('x', 'win'), seat('y', 'loss')], 2)[0]!.delta; // density 1
    const win2of5 = rateMatch([seat('x', 'win'), seat('y', 'loss')], 5)[0]!.delta; // density 0.4
    const win2of10 = rateMatch([seat('x', 'win'), seat('y', 'loss')], 10)[0]!.delta; // density 0.2
    expect(win2of2).toBeGreaterThan(win2of5);
    expect(win2of5).toBeGreaterThan(win2of10);
    expect(win2of10).toBeGreaterThan(0);
  });
});

describe('rateMatch: solo human vs bots uses the bot baseline', () => {
  it('a solo human win is positive but heavily dampened vs a full game', () => {
    const win = rateMatch([seat('solo', 'win')], 7)[0]!;
    const loss = rateMatch([seat('solo', 'loss')], 7)[0]!;
    // A full (density-1) game from the same start, same opponent (bot baseline).
    const fullWin = rateMatch([seat('solo', 'win')], 1)[0]!;
    expect(win.delta).toBeGreaterThan(0);
    expect(loss.delta).toBeLessThan(0);
    // The 1-human/6-bot game moves roughly 1/7 of the full game (density 1/7).
    expect(win.delta).toBeLessThan(fullWin.delta * 0.2);
    expect(win.delta).toBeCloseTo(fullWin.delta / 7, 0);
  });

  it('all-human sweep (no losers) still rates winners vs the bot baseline', () => {
    // Everyone won (e.g. a draw-as-win edge): opposing side is empty → baseline.
    const results = rateMatch([seat('a', 'win'), seat('b', 'win')], 2);
    expect(results.every((r) => r.won)).toBe(true);
    // vs a 1500 baseline from 1500, a win is a small positive move.
    expect(results.every((r) => r.delta > 0)).toBe(true);
  });
});

describe('rateMatch: opposing-average target', () => {
  it('beating a high-rated opposing group gains more than beating a low one', () => {
    const strongLosers = [
      seat('w', 'win'),
      seat('l', 'loss', { rating: 2000, rd: 60, vol: DEFAULT_VOL }),
    ];
    const weakLosers = [
      seat('w', 'win'),
      seat('l', 'loss', { rating: 1000, rd: 60, vol: DEFAULT_VOL }),
    ];
    const gainVsStrong = rateMatch(strongLosers, 2).find((r) => r.userId === 'w')!.delta;
    const gainVsWeak = rateMatch(weakLosers, 2).find((r) => r.userId === 'w')!.delta;
    expect(gainVsStrong).toBeGreaterThan(gainVsWeak);
  });

  it('returns [] for no humans (all-bot table)', () => {
    expect(rateMatch([], 7)).toEqual([]);
  });

  it('exposes the bot baseline constant', () => {
    expect(BOT_BASELINE_MMR).toBe(1500);
  });
});
