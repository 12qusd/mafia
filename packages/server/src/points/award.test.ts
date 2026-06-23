import { describe, it, expect } from 'vitest';
import { detectAchievements } from './award.js';
import type { MatchPlayerRecord } from '../db/types.js';

/** Fresh-account "previous lifetime" baseline (no count-based achievements fire). */
const FRESH = { gamesPlayed: 0, gamesWon: 0, totalPoints: 0 } as const;
/** A baseline that already cleared the count thresholds so they don't pollute. */
const SEASONED = { gamesPlayed: 200, gamesWon: 50, totalPoints: 5000 } as const;

function player(over: Partial<MatchPlayerRecord>): MatchPlayerRecord {
  return {
    userOrGuestId: 'u1',
    seat: 0,
    role: 'CITIZEN',
    faction: 'TOWN',
    outcome: 'loss',
    survived: false,
    deathDay: 2,
    ...over,
  };
}

describe('detectAchievements — win-with-each-role', () => {
  it('awards win_<role> using the seat FINAL role on a win', () => {
    const p = player({ role: 'SHERIFF', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 4, SEASONED, 100, [p]);
    expect(keys).toContain('win_sheriff');
  });

  it('awards win_vampire for a CONVERTED seat that ends a Vampire and wins', () => {
    // started Town, ended Vampire — the record stores the FINAL role.
    const p = player({ role: 'VAMPIRE', faction: 'VAMPIRE', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 6, SEASONED, 100, [p]);
    expect(keys).toContain('win_vampire');
    expect(keys).toContain('feat_turncoat');
  });

  it('does NOT award win_<role> on a loss', () => {
    const p = player({ role: 'GODFATHER', faction: 'MAFIA', outcome: 'loss', survived: false, deathDay: 3 });
    const keys = detectAchievements(p, 5, SEASONED, 100, [p]);
    expect(keys).not.toContain('win_godfather');
  });
});

describe('detectAchievements — feats', () => {
  it('feat_dead_man_wins + feat_first_blood: died night one, won', () => {
    const p = player({ role: 'DOCTOR', faction: 'TOWN', outcome: 'win', survived: false, deathDay: 1 });
    const keys = detectAchievements(p, 5, SEASONED, 100, [p]);
    expect(keys).toContain('feat_dead_man_wins');
    expect(keys).toContain('feat_first_blood');
  });

  it('feat_first_blood without the win when you die night one and lose', () => {
    const p = player({ outcome: 'loss', survived: false, deathDay: 1 });
    const keys = detectAchievements(p, 5, SEASONED, 100, [p]);
    expect(keys).toContain('feat_first_blood');
    expect(keys).not.toContain('feat_dead_man_wins');
  });

  it('feat_last_town_standing: only surviving Town wins', () => {
    const me = player({ seat: 0, role: 'MAYOR', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const deadTown = player({ seat: 1, role: 'DOCTOR', faction: 'TOWN', outcome: 'win', survived: false, deathDay: 3 });
    const evil = player({ seat: 2, role: 'MAFIOSO', faction: 'MAFIA', outcome: 'loss', survived: false, deathDay: 4 });
    const keys = detectAchievements(me, 5, SEASONED, 100, [me, deadTown, evil]);
    expect(keys).toContain('feat_last_town_standing');
  });

  it('NO feat_last_town_standing when another Town survives', () => {
    const me = player({ seat: 0, role: 'MAYOR', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const otherTown = player({ seat: 1, role: 'DOCTOR', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(me, 5, SEASONED, 100, [me, otherTown]);
    expect(keys).not.toContain('feat_last_town_standing');
  });

  it('feat_martyrs_vindication: lynched loyal Town, side still wins', () => {
    const p = player({ role: 'SHERIFF', faction: 'TOWN', outcome: 'win', survived: false, deathDay: 3 });
    const keys = detectAchievements(p, 6, SEASONED, 100, [p]);
    expect(keys).toContain('feat_martyrs_vindication');
  });

  it('feat_pyrrhic: win on the very day you died', () => {
    const p = player({ role: 'VIGILANTE', faction: 'TOWN', outcome: 'win', survived: false, deathDay: 5 });
    const keys = detectAchievements(p, 5, SEASONED, 100, [p]);
    expect(keys).toContain('feat_pyrrhic');
  });

  it('feat_final_curtain + feat_long_haul on a 7+ day game survived & won', () => {
    const p = player({ role: 'JAILOR', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 7, SEASONED, 100, [p]);
    expect(keys).toContain('feat_final_curtain');
    expect(keys).toContain('feat_long_haul');
  });

  it('feat_solo_carry: neutral killer survives and wins', () => {
    const p = player({ role: 'SERIAL_KILLER', faction: 'NEUTRAL_KILLING', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 6, SEASONED, 100, [p]);
    expect(keys).toContain('feat_solo_carry');
    expect(keys).toContain('win_serial_killer');
  });

  it('feat_kingmaker / one_more_drink / pestilence / pirate fire on their role wins', () => {
    const exe = player({ role: 'EXECUTIONER', faction: 'NEUTRAL_BENIGN', outcome: 'win', survived: false, deathDay: 4 });
    expect(detectAchievements(exe, 6, SEASONED, 100, [exe])).toContain('feat_kingmaker');

    const surv = player({ role: 'SURVIVOR', faction: 'NEUTRAL_BENIGN', outcome: 'win', survived: true, deathDay: null });
    expect(detectAchievements(surv, 6, SEASONED, 100, [surv])).toContain('feat_one_more_drink');

    const pest = player({ role: 'PESTILENCE', faction: 'NEUTRAL_KILLING', outcome: 'win', survived: true, deathDay: null });
    expect(detectAchievements(pest, 6, SEASONED, 100, [pest])).toContain('feat_plague_apotheosis');

    const pir = player({ role: 'PIRATE', faction: 'NEUTRAL_BENIGN', outcome: 'win', survived: true, deathDay: null });
    expect(detectAchievements(pir, 6, SEASONED, 100, [pir])).toContain('feat_house_always_wins');
  });

  it('count-based achievements still fire for a fresh account', () => {
    const p = player({ role: 'CITIZEN', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 4, FRESH, 100, [p]);
    expect(keys).toContain('first_win');
    expect(keys).toContain('win_citizen');
  });

  it('only returns keys present in the catalog', () => {
    const p = player({ role: 'CITIZEN', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null });
    const keys = detectAchievements(p, 4, SEASONED, 100, [p]);
    for (const k of keys) expect(k.length).toBeGreaterThan(0);
    // no unknown junk leaks through (filter at end of detector)
    expect(keys).not.toContain('win_nonexistent');
  });
});
