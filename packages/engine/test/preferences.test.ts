/**
 * Point-unlocked role-preference assignment tests (goal 3).
 *
 * Covers the four required guarantees:
 *  1. With NO seatPreferences (default) the assignment is byte-identical to
 *     today's no-preference path (same hashState).
 *  2. A blacklisted role is AVOIDED when a conflict-free assignment exists.
 *  3. A preferred role is hit MORE often than chance over many seeds (soft bias).
 *  4. Preferences never change the role multiset/counts — only the seat↔role
 *     permutation — and same (setup, seed, prefs) ⇒ identical hashState.
 */

import { describe, it, expect } from 'vitest';
import { init, hashState, type SeatPreference } from '../src/index.js';
import { CLASSIC_NOCTURNE, GUNSMOKE, type RoleId } from '@nocturne/shared';

/** Role multiset counts for a state, for "prefs never change composition" checks. */
function roleCounts(seats: { role: RoleId }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of seats) counts[s.role] = (counts[s.role] ?? 0) + 1;
  return counts;
}

/** An all-empty preference array (every seat: no blacklist, no prefer). */
function emptyPrefs(n: number): SeatPreference[] {
  return Array.from({ length: n }, () => ({ blacklist: [], prefer: [] }));
}

describe('§goal-3 preference-aware role assignment', () => {
  it('no seatPreferences ⇒ byte-identical to the no-preference path (hashState)', () => {
    for (let pc = 7; pc <= 15; pc++) {
      const baseline = init(CLASSIC_NOCTURNE, `seed-${pc}`, { playerCount: pc });
      // Passing undefined ⇒ identical.
      const undef = init(CLASSIC_NOCTURNE, `seed-${pc}`, { playerCount: pc });
      expect(hashState(undef)).toBe(hashState(baseline));
      // Passing an ALL-EMPTY prefs array ⇒ still identical (the no-prefs guard
      // treats empty as absent; the PRNG is consumed identically).
      const empty = init(CLASSIC_NOCTURNE, `seed-${pc}`, {
        playerCount: pc,
        seatPreferences: emptyPrefs(pc),
      });
      expect(hashState(empty)).toBe(hashState(baseline));
    }
  });

  it('preferences never change the role multiset (only the seat permutation)', () => {
    // Heavily skewed prefs on a 15p game; counts must equal the no-pref counts.
    const pc = 15;
    const baseline = init(CLASSIC_NOCTURNE, 'mset', { playerCount: pc });
    const baseCounts = roleCounts(baseline.seats);

    const prefs: SeatPreference[] = emptyPrefs(pc);
    prefs[0] = { blacklist: ['MAFIOSO'], prefer: ['SHERIFF'] };
    prefs[1] = { blacklist: ['SHERIFF'], prefer: ['DOCTOR'] };
    prefs[2] = { blacklist: [], prefer: ['JAILOR'] };

    const withPrefs = init(CLASSIC_NOCTURNE, 'mset', { playerCount: pc, seatPreferences: prefs });
    expect(roleCounts(withPrefs.seats)).toEqual(baseCounts);
    expect(withPrefs.seats).toHaveLength(pc);
  });

  it('same (setup, seed, prefs) ⇒ identical hashState (determinism preserved)', () => {
    const pc = 12;
    const prefs: SeatPreference[] = emptyPrefs(pc);
    prefs[0] = { blacklist: ['GODFATHER'], prefer: ['JAILOR'] };
    prefs[3] = { blacklist: [], prefer: ['DOCTOR'] };
    const a = init(CLASSIC_NOCTURNE, 'det-seed', { playerCount: pc, seatPreferences: prefs });
    const b = init(CLASSIC_NOCTURNE, 'det-seed', { playerCount: pc, seatPreferences: prefs });
    expect(hashState(a)).toBe(hashState(b));
  });

  it('blacklisted role is avoided when a conflict-free assignment exists', () => {
    // Classic 15p has many distinct roles; a single seat blacklisting one role is
    // trivially satisfiable. Across many seeds the seat must NEVER get that role.
    const pc = 15;
    const target: RoleId = 'GODFATHER';
    const prefs: SeatPreference[] = emptyPrefs(pc);
    prefs[0] = { blacklist: [target], prefer: [] };

    let everViolated = false;
    for (let i = 0; i < 200; i++) {
      const state = init(CLASSIC_NOCTURNE, `bl-${i}`, { playerCount: pc, seatPreferences: prefs });
      const seat0 = state.seats[0]!;
      if (seat0.role === target) everViolated = true;
    }
    expect(everViolated).toBe(false);
  });

  it('multiple distinct blacklists are all honored when feasible', () => {
    // Three seats each blacklist a distinct role; all are satisfiable in a 15p
    // game (each blacklisted role has only 1 copy, plenty of other seats).
    const pc = 15;
    const prefs: SeatPreference[] = emptyPrefs(pc);
    prefs[0] = { blacklist: ['SHERIFF'], prefer: [] };
    prefs[1] = { blacklist: ['DOCTOR'], prefer: [] };
    prefs[2] = { blacklist: ['JAILOR'], prefer: [] };

    for (let i = 0; i < 100; i++) {
      const state = init(GUNSMOKE, `mbl-${i}`, { playerCount: pc, seatPreferences: prefs });
      expect(state.seats[0]!.role).not.toBe('SHERIFF');
      expect(state.seats[1]!.role).not.toBe('DOCTOR');
      expect(state.seats[2]!.role).not.toBe('JAILOR');
    }
  });

  it('preferred role is hit MORE often than chance over many seeds (soft bias)', () => {
    // Classic 15p contains exactly one JAILOR. Baseline chance that seat 0 gets it
    // is ~1/15. With seat 0 preferring JAILOR, the hit rate must be meaningfully
    // higher (the weighted draw biases without guaranteeing).
    const pc = 15;
    const target: RoleId = 'JAILOR';
    const trials = 600;

    let baselineHits = 0;
    for (let i = 0; i < trials; i++) {
      const state = init(CLASSIC_NOCTURNE, `pref-${i}`, { playerCount: pc });
      if (state.seats[0]!.role === target) baselineHits++;
    }

    const prefs: SeatPreference[] = emptyPrefs(pc);
    prefs[0] = { blacklist: [], prefer: [target] };
    let preferredHits = 0;
    for (let i = 0; i < trials; i++) {
      const state = init(CLASSIC_NOCTURNE, `pref-${i}`, {
        playerCount: pc,
        seatPreferences: prefs,
      });
      if (state.seats[0]!.role === target) preferredHits++;
    }

    // Preferring must raise the hit rate well above the unbiased baseline.
    expect(preferredHits).toBeGreaterThan(baselineHits);
    // And clearly above pure chance (~trials/15 ≈ 40); expect a strong lift.
    expect(preferredHits).toBeGreaterThan((trials / pc) * 1.8);
  });

  it('over-constrained blacklist degrades gracefully (no crash, multiset intact)', () => {
    // Pathological: EVERY seat blacklists the same role that exists in the game.
    // No conflict-free assignment exists (someone must take it), but init must
    // still produce a valid full assignment with the multiset preserved and
    // exactly one violation.
    const pc = 7;
    const baseline = init(CLASSIC_NOCTURNE, 'over', { playerCount: pc });
    const baseCounts = roleCounts(baseline.seats);
    // CITIZEN exists once in Classic 7p; have everyone blacklist it.
    const prefs: SeatPreference[] = Array.from({ length: pc }, () => ({
      blacklist: ['CITIZEN'] as RoleId[],
      prefer: [] as RoleId[],
    }));
    const state = init(CLASSIC_NOCTURNE, 'over', { playerCount: pc, seatPreferences: prefs });
    expect(state.seats).toHaveLength(pc);
    expect(roleCounts(state.seats)).toEqual(baseCounts);
    // Exactly one seat is forced to hold the universally-blacklisted role.
    const violations = state.seats.filter((s) => s.role === 'CITIZEN').length;
    expect(violations).toBe(1);
  });
});
