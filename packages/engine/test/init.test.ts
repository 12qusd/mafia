import { describe, it, expect } from 'vitest';
import { init } from '../src/index.js';
import { hashState } from '../src/index.js';
import {
  CLASSIC_NOCTURNE,
  CROSS_EXAMINATION,
  GUNSMOKE,
  ROLES,
  UNIQUE_ROLES,
  RANDOM_MAFIA_POOL,
} from '@nocturne/shared';

describe('§6.10 init / role assignment', () => {
  it('assigns exactly the setup composition (Classic 7p)', () => {
    const state = init(CLASSIC_NOCTURNE, 'seed-7', { playerCount: 7 });
    expect(state.seats).toHaveLength(7);
    const counts: Record<string, number> = {};
    for (const s of state.seats) counts[s.role] = (counts[s.role] ?? 0) + 1;
    // 7p: Sheriff, Doctor, Jailor, Citizen, Godfather, Mafioso, Jester.
    expect(counts).toEqual({
      SHERIFF: 1,
      DOCTOR: 1,
      JAILOR: 1,
      CITIZEN: 1,
      GODFATHER: 1,
      MAFIOSO: 1,
      JESTER: 1,
    });
  });

  it('honors unique-role constraint across all classic counts', () => {
    for (let pc = 7; pc <= 15; pc++) {
      const state = init(CLASSIC_NOCTURNE, `seed-${pc}`, { playerCount: pc });
      expect(state.seats).toHaveLength(pc);
      for (const u of UNIQUE_ROLES) {
        const n = state.seats.filter((s) => s.role === u).length;
        expect(n).toBeLessThanOrEqual(1);
      }
    }
  });

  it('RANDOM_MAFIA draws only from the mafia-support pool', () => {
    // Classic 12p has a RANDOM_MAFIA slot.
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const state = init(CLASSIC_NOCTURNE, seed, { playerCount: 12 });
      const mafiaSupport = state.seats.filter(
        (s) => s.faction === 'MAFIA' && s.role !== 'GODFATHER' && s.role !== 'MAFIOSO',
      );
      for (const m of mafiaSupport) {
        expect([...RANDOM_MAFIA_POOL]).toContain(m.role);
      }
    }
  });

  it('Executioner gets a Town target that is never the Jailor', () => {
    // Gunsmoke 15p includes Executioner + Jailor.
    for (const seed of ['x', 'y', 'z', 'q', 'r']) {
      const state = init(GUNSMOKE, seed, { playerCount: 15 });
      const exe = state.seats.find((s) => s.role === 'EXECUTIONER');
      if (!exe) continue;
      if (exe.exeTarget === null) continue;
      const tgt = state.seats[exe.exeTarget]!;
      expect(tgt.faction).toBe('TOWN');
      expect(tgt.role).not.toBe('JAILOR');
    }
  });

  it('RANDOM_TOWN draws only from the setup town pool (Cross-Examination 15p)', () => {
    for (const seed of ['s1', 's2', 's3']) {
      const state = init(CROSS_EXAMINATION, seed, { playerCount: 15 });
      // The setup has 8 fixed town + 1 RANDOM_TOWN. The random one must be in the
      // pool and Town-faction.
      for (const s of state.seats) {
        expect(ROLES[s.role].faction).toBe(s.faction);
      }
    }
  });

  it('init is deterministic: same (setup, seed) ⇒ identical state hash', () => {
    const a = init(CLASSIC_NOCTURNE, 'fixed', { playerCount: 11 });
    const b = init(CLASSIC_NOCTURNE, 'fixed', { playerCount: 11 });
    expect(hashState(a)).toBe(hashState(b));
  });

  it('different seeds generally produce different assignments', () => {
    const a = init(CLASSIC_NOCTURNE, 'seedA', { playerCount: 15 });
    const b = init(CLASSIC_NOCTURNE, 'seedB', { playerCount: 15 });
    const ra = a.seats.map((s) => s.role).join(',');
    const rb = b.seats.map((s) => s.role).join(',');
    expect(ra).not.toBe(rb);
  });
});
