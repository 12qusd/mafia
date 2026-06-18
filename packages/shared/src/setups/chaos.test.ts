import { describe, it, expect } from 'vitest';
import { chaosSetup } from './chaos.js';
import { validateSetup } from './validate.js';
import { slotCountAt, factionCountsAt } from './compose.js';

describe('chaosSetup — validity', () => {
  for (let n = 7; n <= 15; n++) {
    it(`single-count chaos passes validateSetup at ${n} players`, () => {
      const setup = chaosSetup('seed-alpha', n);
      expect(validateSetup(setup)).toEqual({ ok: true });
      expect(slotCountAt(setup, n)).toBe(n);
    });
  }

  it('multi-count chaos spans 7..15 and validates at every count', () => {
    const setup = chaosSetup('seed-beta');
    expect(setup.minPlayers).toBe(7);
    expect(setup.maxPlayers).toBe(15);
    expect(validateSetup(setup)).toEqual({ ok: true });
    for (let n = 7; n <= 15; n++) {
      expect(slotCountAt(setup, n)).toBe(n);
      expect(validateSetup(setup, n)).toEqual({ ok: true });
    }
  });

  it('always seats a Mafia core (Godfather + Mafioso)', () => {
    for (let n = 7; n <= 15; n++) {
      const slots = chaosSetup('core', n).slotsByPlayerCount[String(n)]!;
      const roles = slots.flatMap((s) => (s.kind === 'fixed' ? [s.role] : []));
      expect(roles).toContain('GODFATHER');
      expect(roles).toContain('MAFIOSO');
    }
  });

  it('seats a neutral killer at 10+ players', () => {
    for (let n = 10; n <= 15; n++) {
      const counts = factionCountsAt(chaosSetup('nk', n), n)!;
      expect(counts.NEUTRAL_KILLING).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('chaosSetup — determinism', () => {
  it('same (seed, count) produces an identical setup', () => {
    const a = chaosSetup('repeat', 11);
    const b = chaosSetup('repeat', 11);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('same seed produces an identical multi-count setup', () => {
    expect(JSON.stringify(chaosSetup('multi'))).toBe(JSON.stringify(chaosSetup('multi')));
  });

  it('different seeds generally differ', () => {
    const a = chaosSetup('seed-x', 15);
    const b = chaosSetup('seed-y', 15);
    expect(JSON.stringify(a.slotsByPlayerCount)).not.toBe(JSON.stringify(b.slotsByPlayerCount));
  });

  it('ids are namespaced chaos:<seed>', () => {
    expect(chaosSetup('foo').id).toBe('chaos:foo');
    expect(chaosSetup('foo', 9).id).toBe('chaos:foo');
  });
});
