import { describe, it, expect } from 'vitest';
import { validateSetup } from './validate.js';
import { SETUPS, CLASSIC_NOCTURNE } from './index.js';
import type { GameSetup } from '../types/setup.js';

describe('validateSetup — shipped setups', () => {
  for (const setup of SETUPS) {
    it(`${setup.id} is valid`, () => {
      expect(validateSetup(setup)).toEqual({ ok: true });
    });
  }

  it('accepts a shipped setup at an exact in-range player count', () => {
    expect(validateSetup(CLASSIC_NOCTURNE, 9)).toEqual({ ok: true });
  });

  it('rejects an out-of-range player count', () => {
    const res = validateSetup(CLASSIC_NOCTURNE, 16);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('outside'))).toBe(true);
  });

  it('rejects a player count with no slot list', () => {
    const res = validateSetup(CLASSIC_NOCTURNE, 6);
    expect(res.ok).toBe(false);
  });
});

describe('validateSetup — malformed setups', () => {
  const base = (): GameSetup => ({
    id: 'test',
    name: 'Test',
    description: 'test',
    minPlayers: 7,
    maxPlayers: 7,
    townPool: ['CITIZEN'],
    slotsByPlayerCount: {
      '7': [
        { kind: 'fixed', role: 'GODFATHER' },
        { kind: 'fixed', role: 'MAFIOSO' },
        { kind: 'fixed', role: 'SHERIFF' },
        { kind: 'fixed', role: 'DOCTOR' },
        { kind: 'fixed', role: 'JAILOR' },
        { kind: 'fixed', role: 'CITIZEN' },
        { kind: 'fixed', role: 'JESTER' },
      ],
    },
  });

  it('the base fixture is itself valid', () => {
    expect(validateSetup(base())).toEqual({ ok: true });
  });

  it('flags a wrong slot count', () => {
    const s = base();
    s.slotsByPlayerCount['7'] = s.slotsByPlayerCount['7']!.slice(0, 6);
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('slot count'))).toBe(true);
  });

  it('flags an unknown fixed role', () => {
    const s = base();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.slotsByPlayerCount['7']![0] = { kind: 'fixed', role: 'WIZARD' as any };
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('unknown role'))).toBe(true);
  });

  it('flags a duplicated unique role', () => {
    const s = base();
    s.slotsByPlayerCount['7']![5] = { kind: 'fixed', role: 'JAILOR' };
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('unique role'))).toBe(true);
  });

  it('flags a setup with no killing role', () => {
    const s = base();
    // No Mafia, no `kill` role, no Jailor execution → unwinnable.
    s.slotsByPlayerCount['7'] = [
      { kind: 'fixed', role: 'SHERIFF' },
      { kind: 'fixed', role: 'DOCTOR' },
      { kind: 'fixed', role: 'INVESTIGATOR' },
      { kind: 'fixed', role: 'CITIZEN' },
      { kind: 'fixed', role: 'ESCORT' },
      { kind: 'fixed', role: 'LOOKOUT' },
      { kind: 'fixed', role: 'MAYOR' },
    ];
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('killing role'))).toBe(true);
  });

  it('flags a non-Town role in a RANDOM_TOWN pool', () => {
    const s = base();
    s.townPool = ['GODFATHER'];
    s.slotsByPlayerCount['7']![5] = { kind: 'category', category: 'RANDOM_TOWN' };
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('non-Town'))).toBe(true);
  });

  it('flags an empty townPool when RANDOM_TOWN is used', () => {
    const s = base();
    s.townPool = [];
    s.slotsByPlayerCount['7']![5] = { kind: 'category', category: 'RANDOM_TOWN' };
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('townPool is empty'))).toBe(true);
  });

  it('flags an unknown townPool role', () => {
    const s = base();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.townPool = ['NOPE' as any];
    const res = validateSetup(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('townPool references unknown'))).toBe(true);
  });
});
