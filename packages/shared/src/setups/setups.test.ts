import { describe, it, expect } from 'vitest';
import {
  CLASSIC_NOCTURNE,
  CROSS_EXAMINATION,
  GUNSMOKE,
  SMOKE_AND_MIRRORS,
  FULL_MOON,
  RECKONING,
  LONG_NIGHT,
  FAITHFUL,
  COLD_CASES,
  SETUPS,
  getSetup,
  factionCountsAt,
  slotCountAt,
  validateSetup,
} from './index.js';
import { UNIQUE_ROLES } from '../roles/index.js';
import type { SetupSlot } from '../types/setup.js';
import { ROLES } from '../roles/index.js';

/**
 * BUILD_SPEC §6.10 faction table for Classic Nocturne. Neutral here is the sum
 * of NEUTRAL_KILLING + NEUTRAL_BENIGN.
 */
const CLASSIC_TABLE: Record<number, { town: number; mafia: number; neutral: number }> = {
  7: { town: 4, mafia: 2, neutral: 1 },
  8: { town: 5, mafia: 2, neutral: 1 },
  9: { town: 6, mafia: 2, neutral: 1 },
  10: { town: 6, mafia: 2, neutral: 2 },
  11: { town: 7, mafia: 2, neutral: 2 },
  12: { town: 7, mafia: 3, neutral: 2 },
  13: { town: 8, mafia: 3, neutral: 2 },
  14: { town: 8, mafia: 3, neutral: 3 },
  15: { town: 9, mafia: 3, neutral: 3 },
};

describe('Classic Nocturne setup (§6.10)', () => {
  for (let n = 7; n <= 15; n++) {
    it(`${n} players: slot count == player count`, () => {
      expect(slotCountAt(CLASSIC_NOCTURNE, n)).toBe(n);
    });

    it(`${n} players: faction counts match the spec table`, () => {
      const counts = factionCountsAt(CLASSIC_NOCTURNE, n);
      expect(counts).toBeDefined();
      if (!counts) return;
      const expected = CLASSIC_TABLE[n]!;
      expect(counts.TOWN).toBe(expected.town);
      expect(counts.MAFIA).toBe(expected.mafia);
      expect(counts.NEUTRAL_KILLING + counts.NEUTRAL_BENIGN).toBe(expected.neutral);
    });
  }

  it('spans 7..15', () => {
    expect(CLASSIC_NOCTURNE.minPlayers).toBe(7);
    expect(CLASSIC_NOCTURNE.maxPlayers).toBe(15);
  });
});

/** Verify no setup over-allocates a unique role (§6.10 constraint). */
function maxFixedRoleCount(slots: readonly SetupSlot[], roleId: string): number {
  return slots.filter((s) => s.kind === 'fixed' && s.role === roleId).length;
}

describe('curated 15-player setups (§6.10)', () => {
  for (const setup of [CROSS_EXAMINATION, GUNSMOKE, SMOKE_AND_MIRRORS, FULL_MOON]) {
    it(`${setup.id}: has exactly 15 slots`, () => {
      expect(slotCountAt(setup, 15)).toBe(15);
    });

    it(`${setup.id}: pinned to 15 players`, () => {
      expect(setup.minPlayers).toBe(15);
      expect(setup.maxPlayers).toBe(15);
    });

    it(`${setup.id}: never exceeds a unique role's cap`, () => {
      const slots = setup.slotsByPlayerCount['15']!;
      for (const u of UNIQUE_ROLES) {
        expect(maxFixedRoleCount(slots, u)).toBeLessThanOrEqual(1);
      }
    });
  }

  it('Cross-Examination is investigation-heavy (3 info roles + framer)', () => {
    const slots = CROSS_EXAMINATION.slotsByPlayerCount['15']!;
    const info = slots.filter(
      (s) => s.kind === 'fixed' && ['SHERIFF', 'INVESTIGATOR', 'LOOKOUT'].includes(s.role),
    ).length;
    expect(info).toBeGreaterThanOrEqual(3);
    expect(maxFixedRoleCount(slots, 'FRAMER')).toBe(1);
  });

  it('Gunsmoke is kill-heavy (2 vigilantes + SK)', () => {
    const slots = GUNSMOKE.slotsByPlayerCount['15']!;
    expect(maxFixedRoleCount(slots, 'VIGILANTE')).toBe(2);
    expect(maxFixedRoleCount(slots, 'SERIAL_KILLER')).toBe(1);
  });

  it('The Long Night fields 2 Vampires + a Vampire Hunter (15 slots, validates)', () => {
    expect(slotCountAt(LONG_NIGHT, 15)).toBe(15);
    expect(LONG_NIGHT.minPlayers).toBe(15);
    expect(LONG_NIGHT.maxPlayers).toBe(15);
    const slots = LONG_NIGHT.slotsByPlayerCount['15']!;
    expect(maxFixedRoleCount(slots, 'VAMPIRE')).toBe(2);
    expect(maxFixedRoleCount(slots, 'VAMPIRE_HUNTER')).toBe(1);
    const counts = factionCountsAt(LONG_NIGHT, 15)!;
    expect(counts.VAMPIRE).toBe(2);
    // Validation passes (the Vampire conversion counts as a killing path).
    expect(validateSetup(LONG_NIGHT, 15)).toEqual({ ok: true });
  });

  it('The Faithful fields a lone Cult Leader (15 slots, validates)', () => {
    expect(slotCountAt(FAITHFUL, 15)).toBe(15);
    expect(FAITHFUL.minPlayers).toBe(15);
    expect(FAITHFUL.maxPlayers).toBe(15);
    const slots = FAITHFUL.slotsByPlayerCount['15']!;
    expect(maxFixedRoleCount(slots, 'CULT_LEADER')).toBe(1);
    // The Cult Leader is unique — exactly one per game (the sole recruiter).
    expect(maxFixedRoleCount(slots, 'CULT_LEADER')).toBeLessThanOrEqual(1);
    const counts = factionCountsAt(FAITHFUL, 15)!;
    expect(counts.CULT).toBe(1);
    // Validation passes (the Cult recruitment counts as a killing/terminal path).
    expect(validateSetup(FAITHFUL, 15)).toEqual({ ok: true });
  });
});

describe('Classic Nocturne unique-role constraint (§6.10)', () => {
  for (let n = 7; n <= 15; n++) {
    it(`${n} players: no unique role appears twice`, () => {
      const slots = CLASSIC_NOCTURNE.slotsByPlayerCount[String(n)]!;
      for (const u of UNIQUE_ROLES) {
        expect(maxFixedRoleCount(slots, u)).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('setup registry', () => {
  it('ships the curated setups (3 MVP + batch-A/D showcases + Tong War + Reckoning + Long Night + Faithful + Cold Cases)', () => {
    expect(SETUPS).toHaveLength(10);
  });

  it('getSetup resolves by id', () => {
    expect(getSetup('classic-nocturne')).toBe(CLASSIC_NOCTURNE);
    expect(getSetup('cross-examination')).toBe(CROSS_EXAMINATION);
    expect(getSetup('gunsmoke')).toBe(GUNSMOKE);
    expect(getSetup('smoke-and-mirrors')).toBe(SMOKE_AND_MIRRORS);
    expect(getSetup('full-moon')).toBe(FULL_MOON);
    expect(getSetup('reckoning')).toBe(RECKONING);
    expect(getSetup('the-long-night')).toBe(LONG_NIGHT);
    expect(getSetup('the-faithful')).toBe(FAITHFUL);
    expect(getSetup('cold-cases')).toBe(COLD_CASES);
    expect(getSetup('nope')).toBeUndefined();
  });

  it('every fixed slot references a real role', () => {
    for (const setup of SETUPS) {
      for (const slots of Object.values(setup.slotsByPlayerCount)) {
        for (const slot of slots) {
          if (slot.kind === 'fixed') {
            expect(ROLES[slot.role]).toBeDefined();
          }
        }
      }
    }
  });

  it('every RANDOM_TOWN pool entry is a Town role', () => {
    for (const setup of SETUPS) {
      for (const roleId of setup.townPool) {
        expect(ROLES[roleId].faction).toBe('TOWN');
      }
    }
  });
});
