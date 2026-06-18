import { describe, it, expect } from 'vitest';
import {
  computeMatchPoints,
  tierForPoints,
  POINTS,
  POINTS_TIERS,
  ACHIEVEMENTS_BY_KEY,
  achievementPoints,
} from './points.js';

describe('computeMatchPoints', () => {
  it('awards the played base for a finished game', () => {
    const b = computeMatchPoints({ outcome: 'loss', survived: false, deathDay: 3, finalDay: 3 });
    expect(b.awards.some((a) => a.code === 'played')).toBe(true);
    expect(b.total).toBe(POINTS.PLAYED);
  });

  it('a quitter forfeits the played base and loyalty bonus', () => {
    const b = computeMatchPoints({ outcome: 'left', survived: false, deathDay: 1, finalDay: 6 });
    expect(b.awards.length).toBe(0);
    expect(b.total).toBe(0);
  });

  it('stacks win + survived bonuses', () => {
    const b = computeMatchPoints({ outcome: 'win', survived: true, deathDay: null, finalDay: 5 });
    expect(b.total).toBe(POINTS.PLAYED + POINTS.WIN + POINTS.SURVIVED_TO_END);
  });

  it('scales the loyalty bonus by days spent dead, capped', () => {
    const small = computeMatchPoints({ outcome: 'loss', survived: false, deathDay: 4, finalDay: 6 });
    const loyal = small.awards.find((a) => a.code === 'loyalty_dead');
    expect(loyal?.points).toBe(2 * POINTS.LOYALTY_PER_DAY_DEAD);

    const huge = computeMatchPoints({ outcome: 'loss', survived: false, deathDay: 1, finalDay: 99 });
    const cap = huge.awards.find((a) => a.code === 'loyalty_dead');
    expect(cap?.points).toBe(POINTS.LOYALTY_MAX);
  });

  it('does not award loyalty when the player dies on the final day', () => {
    const b = computeMatchPoints({ outcome: 'loss', survived: false, deathDay: 5, finalDay: 5 });
    expect(b.awards.some((a) => a.code === 'loyalty_dead')).toBe(false);
  });

  it('includes achievement points for unlocked keys', () => {
    const b = computeMatchPoints({
      outcome: 'win',
      survived: true,
      deathDay: null,
      finalDay: 4,
      achievements: ['first_win'],
    });
    const ach = b.awards.find((a) => a.code === 'achievement' && a.detail === 'first_win');
    expect(ach?.points).toBe(ACHIEVEMENTS_BY_KEY['first_win']?.points);
  });

  it('is pure: same input ⇒ identical output', () => {
    const input = { outcome: 'win' as const, survived: false, deathDay: 2, finalDay: 7 };
    expect(computeMatchPoints(input)).toEqual(computeMatchPoints(input));
  });
});

describe('tierForPoints', () => {
  it('maps zero points to the lowest tier', () => {
    expect(tierForPoints(0).key).toBe(POINTS_TIERS[0]!.key);
  });
  it('is monotonic across thresholds', () => {
    expect(tierForPoints(100).key).toBe('drifter');
    expect(tierForPoints(250).key).toBe('made');
    expect(tierForPoints(5000).key).toBe('boss');
    expect(tierForPoints(1_000_000).key).toBe('kingpin');
  });
});

describe('achievementPoints', () => {
  it('returns 0 for unknown keys', () => {
    expect(achievementPoints('nope')).toBe(0);
  });
});
