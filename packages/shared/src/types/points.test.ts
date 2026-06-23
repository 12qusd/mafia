import { describe, it, expect } from 'vitest';
import {
  computeMatchPoints,
  tierForPoints,
  POINTS,
  POINTS_TIERS,
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_KEY,
  achievementPoints,
  unlocksFor,
  UNLOCKS,
} from './points.js';
import {
  ROLE_WIN_ACHIEVEMENTS,
  FEAT_ACHIEVEMENTS,
  ROLE_WIN_KEY_BY_ROLE,
  roleWinKey,
} from './achievements.js';
import { ALL_ROLES } from '../roles/index.js';

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

describe('role-win achievement catalog', () => {
  it('generates exactly one win achievement per role in ALL_ROLES', () => {
    expect(ROLE_WIN_ACHIEVEMENTS).toHaveLength(ALL_ROLES.length);
  });

  it('keys every role to a `win_<roleid_lowercase>` achievement', () => {
    for (const role of ALL_ROLES) {
      const key = roleWinKey(role.id);
      expect(key).toBe(`win_${role.id.toLowerCase()}`);
      expect(ROLE_WIN_KEY_BY_ROLE[role.id]).toBe(key);
      expect(ACHIEVEMENTS_BY_KEY[key]).toBeDefined();
      expect(ACHIEVEMENTS_BY_KEY[key]?.name).toBe(`Win as ${role.name}`);
    }
  });

  it('covers a few known keys with sensible point tiers', () => {
    expect(ACHIEVEMENTS_BY_KEY['win_sheriff']?.points).toBe(25); // vanilla town
    expect(ACHIEVEMENTS_BY_KEY['win_godfather']?.points).toBe(25); // informed evil
    expect(ACHIEVEMENTS_BY_KEY['win_serial_killer']?.points).toBe(40); // neutral killer
    expect(ACHIEVEMENTS_BY_KEY['win_vampire']?.points).toBe(40); // converter killer
    expect(ACHIEVEMENTS_BY_KEY['win_jester']?.points).toBe(50); // trickster
    expect(ACHIEVEMENTS_BY_KEY['win_pirate']?.points).toBe(50); // trickster
  });

  it('folds role-win + feat achievements into the public catalog with unique keys', () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
    for (const a of ROLE_WIN_ACHIEVEMENTS) expect(keys).toContain(a.key);
    for (const a of FEAT_ACHIEVEMENTS) expect(keys).toContain(a.key);
  });
});

describe('unlocksFor', () => {
  it('locks both perks below the blacklist threshold and points to it', () => {
    const u = unlocksFor(0);
    expect(u.canBlacklistRoles).toBe(false);
    expect(u.canPreferRoles).toBe(false);
    expect(u.nextUnlock).toEqual({ label: 'Role blacklisting', at: UNLOCKS.ROLE_BLACKLIST_AT });
  });

  it('unlocks blacklisting at the threshold and points to preference next', () => {
    const u = unlocksFor(UNLOCKS.ROLE_BLACKLIST_AT);
    expect(u.canBlacklistRoles).toBe(true);
    expect(u.canPreferRoles).toBe(false);
    expect(u.nextUnlock).toEqual({ label: 'Role preference', at: UNLOCKS.ROLE_PREFER_AT });
  });

  it('unlocks everything at the preference threshold with no next milestone', () => {
    const u = unlocksFor(UNLOCKS.ROLE_PREFER_AT);
    expect(u.canBlacklistRoles).toBe(true);
    expect(u.canPreferRoles).toBe(true);
    expect(u.nextUnlock).toBeNull();
  });

  it('orders the thresholds blacklist < prefer', () => {
    expect(UNLOCKS.ROLE_BLACKLIST_AT).toBeLessThan(UNLOCKS.ROLE_PREFER_AT);
  });
});
