import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  fingerprintMatch,
  verifyFingerprint,
  type FingerprintInput,
} from './fingerprint.js';

const SECRET = 'unit-test-secret';

function sample(): FingerprintInput {
  return {
    id: 'm1',
    setupId: 'classic',
    seed: 'seed-abc',
    outcome: 'completed',
    players: [
      { userOrGuestId: 'u2', seat: 1, role: 'DOCTOR', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null },
      { userOrGuestId: 'u1', seat: 0, role: 'MAFIOSO', faction: 'MAFIA', outcome: 'loss', survived: false, deathDay: 2 },
    ],
    events: [
      { seq: 1, phase: 'NIGHT', event: { type: 'phase_end' } },
      { seq: 0, phase: 'DAY_0', event: { type: 'chat', seat: 0 } },
    ],
    chat: [{ seq: 0, channel: 'day', senderSeat: 0, body: 'gg' }],
  };
}

describe('canonicalize', () => {
  it('sorts object keys recursively and is order-independent', () => {
    expect(canonicalize({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('fingerprintMatch', () => {
  it('is stable regardless of player/event/key ordering (JSONB round-trip safe)', () => {
    const a = sample();
    const b = sample();
    b.players.reverse();
    b.events.reverse();
    expect(fingerprintMatch(a, SECRET)).toBe(fingerprintMatch(b, SECRET));
  });

  it('changes when any replay-bearing field changes', () => {
    const a = sample();
    const tampered = sample();
    tampered.players[0]!.role = 'GODFATHER';
    expect(fingerprintMatch(a, SECRET)).not.toBe(fingerprintMatch(tampered, SECRET));
  });

  it('changes with the secret (unforgeable without the key)', () => {
    const a = sample();
    expect(fingerprintMatch(a, SECRET)).not.toBe(fingerprintMatch(a, 'other-secret'));
  });

  it('is prefixed sha256:', () => {
    expect(fingerprintMatch(sample(), SECRET)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('verifyFingerprint', () => {
  it('accepts a correct fingerprint and rejects a wrong/absent one', () => {
    const a = sample();
    const fp = fingerprintMatch(a, SECRET);
    expect(verifyFingerprint(a, SECRET, fp)).toBe(true);
    expect(verifyFingerprint(a, SECRET, null)).toBe(false);
    expect(verifyFingerprint(a, SECRET, 'sha256:deadbeef')).toBe(false);
    const tampered = sample();
    tampered.seed = 'different';
    expect(verifyFingerprint(tampered, SECRET, fp)).toBe(false);
  });
});
