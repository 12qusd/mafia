/**
 * Glicko-2 unit tests, validated against Glickman's published worked example
 * ("Example of the Glicko-2 system", 2013) and the documented Nocturne rank
 * ladder. The reference example is the oracle: player (1500, 200, 0.06), tau=0.5,
 * three results — win vs (1400,30), loss vs (1550,100), loss vs (1700,300) —
 * yields rating≈1464.06, rd≈151.52, vol≈0.05999.
 */

import { describe, it, expect } from 'vitest';
import {
  updateRating,
  toGlicko2,
  fromGlicko2,
  rankForMmr,
  nextRankThreshold,
  softResetRating,
  inflateForInactivity,
  inactivePeriods,
  RANK_TIERS,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  SEASON_MEAN,
  SEASON_CARRY,
  SEASON_RESET_RD,
  RATING_PERIOD_MS,
  type Glicko,
} from './glicko.js';

describe('Glicko-2 scale conversions', () => {
  it('round-trips a rating through the Glicko-2 scale', () => {
    const g: Glicko = { rating: 1842, rd: 211, vol: 0.053 };
    const back = fromGlicko2(toGlicko2(g));
    expect(back.rating).toBeCloseTo(g.rating, 6);
    expect(back.rd).toBeCloseTo(g.rd, 6);
    expect(back.vol).toBeCloseTo(g.vol, 6);
  });

  it('maps the default rating to mu 0', () => {
    const { mu } = toGlicko2({ rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL });
    expect(mu).toBeCloseTo(0, 9);
  });
});

describe('Glicko-2 updateRating (reference example)', () => {
  it('matches Glickman 2013 worked example to 2 decimals', () => {
    const player: Glicko = { rating: 1500, rd: 200, vol: 0.06 };
    const result = updateRating(player, [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ]);
    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.vol).toBeCloseTo(0.05999, 4);
  });

  it('a win against a peer raises rating; a loss lowers it', () => {
    const player: Glicko = { rating: 1500, rd: 200, vol: 0.06 };
    const won = updateRating(player, [{ rating: 1500, rd: 200, score: 1 }]);
    const lost = updateRating(player, [{ rating: 1500, rd: 200, score: 0 }]);
    expect(won.rating).toBeGreaterThan(1500);
    expect(lost.rating).toBeLessThan(1500);
  });

  it('a game (any opponents) reduces RD from the high starting value', () => {
    const player: Glicko = { rating: 1500, rd: 350, vol: 0.06 };
    const after = updateRating(player, [{ rating: 1500, rd: 350, score: 1 }]);
    expect(after.rd).toBeLessThan(350);
  });

  it('did-not-compete only inflates RD (rating + vol unchanged)', () => {
    const player: Glicko = { rating: 1632, rd: 120, vol: 0.058 };
    const after = updateRating(player, []);
    expect(after.rating).toBeCloseTo(player.rating, 9);
    expect(after.vol).toBeCloseTo(player.vol, 9);
    expect(after.rd).toBeGreaterThan(player.rd);
  });

  it('beating a much stronger opponent gains more than beating a weaker one', () => {
    const player: Glicko = { rating: 1500, rd: 200, vol: 0.06 };
    const beatStrong = updateRating(player, [{ rating: 1900, rd: 60, score: 1 }]);
    const beatWeak = updateRating(player, [{ rating: 1100, rd: 60, score: 1 }]);
    expect(beatStrong.rating - 1500).toBeGreaterThan(beatWeak.rating - 1500);
  });
});

describe('rank ladder', () => {
  it('rankForMmr is a total floor map over the tiers', () => {
    expect(rankForMmr(0).key).toBe('stray');
    expect(rankForMmr(-500).key).toBe('stray'); // below floor still maps
    expect(rankForMmr(1500).key).toBe('fixer');
    expect(rankForMmr(1699).key).toBe('fixer');
    expect(rankForMmr(1700).key).toBe('shadow');
    expect(rankForMmr(99999).key).toBe('don'); // top rung
  });

  it('rankForMmr index increases with the ladder', () => {
    for (let i = 1; i < RANK_TIERS.length; i++) {
      const lo = rankForMmr((RANK_TIERS[i - 1] as { minMmr: number }).minMmr);
      const hi = rankForMmr((RANK_TIERS[i] as { minMmr: number }).minMmr);
      expect(hi.index).toBe(lo.index + 1);
    }
  });

  it('rank names are distinct from the lifetime points tiers', () => {
    const rankNames = new Set(RANK_TIERS.map((t) => t.name.toLowerCase()));
    for (const pt of ['drifter', 'made', 'capo', 'boss', 'kingpin']) {
      expect(rankNames.has(pt)).toBe(false);
    }
  });

  it('nextRankThreshold points at the next rung, null at the top', () => {
    const next = nextRankThreshold(1500);
    expect(next?.at).toBe(1700);
    expect(next?.name).toBe('Shadow');
    expect(nextRankThreshold(50000)).toBeNull();
  });
});

describe('season soft-reset (softResetRating)', () => {
  it('pulls a rating toward the mean by SEASON_CARRY', () => {
    const high = softResetRating({ rating: 2300, rd: 80, vol: 0.05 });
    // 1500 + (2300-1500)*0.5 = 1900
    expect(high.rating).toBeCloseTo(SEASON_MEAN + (2300 - SEASON_MEAN) * SEASON_CARRY, 6);
    expect(high.rating).toBeCloseTo(1900, 6);

    const low = softResetRating({ rating: 1100, rd: 80, vol: 0.05 });
    expect(low.rating).toBeCloseTo(SEASON_MEAN + (1100 - SEASON_MEAN) * SEASON_CARRY, 6);
    expect(low.rating).toBeCloseTo(1300, 6);
  });

  it('preserves relative ordering (a soft-reset is monotonic in old MMR)', () => {
    const a = softResetRating({ rating: 1800, rd: 80, vol: 0.05 }).rating;
    const b = softResetRating({ rating: 1600, rd: 80, vol: 0.05 }).rating;
    expect(a).toBeGreaterThan(b);
  });

  it('leaves a mean rating at the mean', () => {
    expect(softResetRating({ rating: SEASON_MEAN, rd: 90, vol: 0.05 }).rating).toBeCloseTo(
      SEASON_MEAN,
      6,
    );
  });

  it('re-inflates RD up to the reset value and resets volatility', () => {
    const tight = softResetRating({ rating: 1700, rd: 60, vol: 0.04 });
    expect(tight.rd).toBe(SEASON_RESET_RD); // widened up from 60
    expect(tight.vol).toBe(DEFAULT_VOL);

    // An already-wide RD is kept (the reset only RAISES uncertainty).
    const wide = softResetRating({ rating: 1700, rd: 300, vol: 0.04 });
    expect(wide.rd).toBe(300);
  });
});

describe('inactivity RD inflation (inflateForInactivity)', () => {
  it('is a no-op for zero or negative periods', () => {
    expect(inflateForInactivity(120, DEFAULT_VOL, 0)).toBe(120);
    expect(inflateForInactivity(120, DEFAULT_VOL, -3)).toBe(120);
  });

  it('grows RD with more inactive periods (monotonic non-decreasing)', () => {
    const r1 = inflateForInactivity(120, DEFAULT_VOL, 1);
    const r4 = inflateForInactivity(120, DEFAULT_VOL, 4);
    const r12 = inflateForInactivity(120, DEFAULT_VOL, 12);
    expect(r1).toBeGreaterThan(120);
    expect(r4).toBeGreaterThanOrEqual(r1);
    expect(r12).toBeGreaterThanOrEqual(r4);
  });

  it('matches the closed-form Glicko-2 RD-grows-with-time step', () => {
    // φ' = sqrt(φ² + σ²·t) on the Glicko-2 scale, mapped back. One period from a
    // tight RD should equal the single did-not-compete step's RD.
    const player: Glicko = { rating: 1632, rd: 120, vol: 0.058 };
    const oneStep = updateRating(player, []); // single skipped period
    const inflated = inflateForInactivity(player.rd, player.vol, 1);
    expect(inflated).toBeCloseTo(oneStep.rd, 6);
  });

  it('never exceeds the cold-start ceiling (clamped to DEFAULT_RD)', () => {
    const huge = inflateForInactivity(340, DEFAULT_VOL, 100_000);
    expect(huge).toBeLessThanOrEqual(DEFAULT_RD);
    expect(huge).toBe(DEFAULT_RD);
  });

  it('whole rating periods are floored from a passed-in clock', () => {
    const base = 1_000_000_000;
    expect(inactivePeriods(base, base)).toBe(0);
    expect(inactivePeriods(base, base + RATING_PERIOD_MS - 1)).toBe(0);
    expect(inactivePeriods(base, base + RATING_PERIOD_MS)).toBe(1);
    expect(inactivePeriods(base, base + RATING_PERIOD_MS * 3.9)).toBe(3);
    expect(inactivePeriods(base, base - 5)).toBe(0); // never negative
  });
});
