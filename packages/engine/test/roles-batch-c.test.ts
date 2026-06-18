import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, toNextNight } from './harness.js';
import type { Effect } from '@nocturne/shared';

/** Find a private_result effect of a given kind addressed to `seat`. */
function privateResult(effects: Effect[], seat: number, kind: string) {
  return effects.find(
    (e) =>
      Array.isArray(e.to) &&
      e.to.length === 1 &&
      e.to[0] === seat &&
      (e.msg as { type?: string }).type === 'private_result' &&
      (e.msg as { kind?: string }).kind === kind,
  );
}

describe('batch C — Crusader (Town protective/striker)', () => {
  it('kills the lowest-seat visitor to its ward (excluding ward and self)', () => {
    // 0 Crusader (guards 1), 1 Citizen (ward), 2 Sheriff (visits 1), 3 Lookout
    // (visits 1), 4 Godfather, 5 Citizen.
    let s = makeGame(['CRUSADER', 'CITIZEN', 'SHERIFF', 'LOOKOUT', 'GODFATHER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'crusade', 1); // guard seat 1
    s = night(s, 2, 'investigate_sheriff', 1); // sheriff visits ward
    s = night(s, 3, 'watch', 1); // lookout visits ward
    const { state, effects } = resolveNightPhase(s);

    // Lowest-seat visitor to the ward (2 the Sheriff) is struck.
    const trace = state.traces.find((t) => t.step === 'crusade');
    expect(trace).toMatchObject({ step: 'crusade', crusader: 0, ward: 1, struck: 2 });
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[2]!.deathCause).toBe('crusader');
    // Higher-seat visitor (3 the Lookout) and the ward survive.
    expect(state.seats[3]!.alive).toBe(true);
    expect(state.seats[1]!.alive).toBe(true);

    const death = effects.find(
      (e) => e.to === 'public' && (e.msg as { seat?: number }).seat === 2 &&
        (e.msg as { type?: string }).type === 'death_announce',
    );
    expect(death).toBeDefined();
    expect((death!.msg as { cause?: string }).cause).toBe('crusader');
  });

  it('shields its ward from one basic attack (mafia kill)', () => {
    // 0 Crusader (guards 1), 1 Citizen (ward, mafia target), 2 Godfather (control),
    // 3 Mafioso (kills 1), 4 Citizen, 5 Citizen.
    let s = makeGame(['CRUSADER', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'crusade', 1);
    s = night(s, 2, 'mafia_control', 1);
    s = night(s, 3, 'kill_mafia', 1);
    const { state } = resolveNightPhase(s);
    // The ward survives (shielded). The mafia performer (seat 3) visited the ward,
    // so the Crusader strikes them.
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.seats[3]!.alive).toBe(false);
    expect(state.seats[3]!.deathCause).toBe('crusader');
  });

  it('strikes nobody when no one visits the ward (only a trace)', () => {
    let s = makeGame(['CRUSADER', 'CITIZEN', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'crusade', 1);
    const { state } = resolveNightPhase(s);
    const trace = state.traces.find((t) => t.step === 'crusade');
    expect(trace).toMatchObject({ step: 'crusade', crusader: 0, ward: 1, struck: null });
    for (const seat of state.seats) expect(seat.alive).toBe(true);
  });

  it('a night-immune visitor (Serial Killer) shrugs off the strike', () => {
    // 0 Crusader (guards 1), 1 Citizen (ward), 2 Serial Killer (visits/kills 1),
    // 3 Godfather, 4..5 Citizen.
    let s = makeGame(['CRUSADER', 'CITIZEN', 'SERIAL_KILLER', 'GODFATHER', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'crusade', 1);
    s = night(s, 2, 'kill_serial', 1);
    const { state } = resolveNightPhase(s);
    // The ward is shielded (survives); the SK visited and is struck, but is
    // night-immune, so it survives.
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.seats[2]!.alive).toBe(true);
    const trace = state.traces.find((t) => t.step === 'crusade');
    expect(trace).toMatchObject({ struck: 2 });
  });
});

describe('batch C — Ambusher (Mafia striker)', () => {
  it('kills the lowest-seat visitor to the staked-out house (excluding self)', () => {
    // 0 Ambusher (stakes out 3), 1 Godfather, 2 Sheriff (visits 3), 3 Citizen,
    // 4 Doctor (visits 3), 5 Citizen.
    let s = makeGame(['AMBUSHER', 'GODFATHER', 'SHERIFF', 'CITIZEN', 'DOCTOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'ambush', 3);
    s = night(s, 2, 'investigate_sheriff', 3);
    s = night(s, 4, 'protect', 3);
    const { state } = resolveNightPhase(s);
    // Lowest-seat visitor to seat 3 (the Sheriff, seat 2) is killed.
    const trace = state.traces.find((t) => t.step === 'ambush');
    expect(trace).toMatchObject({ step: 'ambush', ambusher: 0, target: 3, struck: 2 });
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[2]!.deathCause).toBe('ambush');
    // The doctor (higher seat) and the watched seat survive.
    expect(state.seats[4]!.alive).toBe(true);
    expect(state.seats[3]!.alive).toBe(true);
  });

  it('the Ambusher visits the location (a Lookout on that house sees them)', () => {
    // 0 Ambusher (stakes out 3), 1 Godfather, 2 Lookout (watches 3), 3 Citizen,
    // 4..5 Citizen.
    let s = makeGame(['AMBUSHER', 'GODFATHER', 'LOOKOUT', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'ambush', 3);
    s = night(s, 2, 'watch', 3);
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 2, 'lookout_result');
    // The Ambusher (seat 0) visited seat 3, so the Lookout watching seat 3 sees it.
    expect((eff!.msg as { visitors?: number[] }).visitors).toContain(0);
  });

  it('strikes nobody when no one else visits the house', () => {
    let s = makeGame(['AMBUSHER', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'ambush', 3);
    const { state } = resolveNightPhase(s);
    const trace = state.traces.find((t) => t.step === 'ambush');
    expect(trace).toMatchObject({ struck: null });
    for (const seat of state.seats) expect(seat.alive).toBe(true);
  });
});

describe('batch C — Psychic (Town vision)', () => {
  it('odd night: vision contains at least one EVIL seat, carries no roles', () => {
    // Night 1 (odd) → evil parity. 0 Psychic, 1 Godfather (evil), 2 Mafioso (evil),
    // 3..5 Citizen (good).
    let s = makeGame(['PSYCHIC', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'divine', null);
    const { state, effects } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'divine');
    expect(trace).toMatchObject({ step: 'divine', psychic: 0, parity: 'evil' });

    const eff = privateResult(effects, 0, 'psychic_vision');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]);
    const msg = eff!.msg as { parity?: string; seats?: number[] };
    expect(msg.parity).toBe('evil');
    // The vision must contain at least one evil seat (1 or 2).
    const evilSeats = new Set([1, 2]);
    expect(msg.seats!.some((seat) => evilSeats.has(seat))).toBe(true);
    // Never the Psychic itself.
    expect(msg.seats).not.toContain(0);
    // Carries NO role strings.
    const body = JSON.stringify(eff!.msg);
    expect(body).not.toContain('GODFATHER');
    expect(body).not.toContain('MAFIOSO');
    expect(body).not.toContain('CITIZEN');
    expect(body).not.toContain('PSYCHIC');
    // Seats are sorted.
    expect(msg.seats!.slice().sort((a, b) => a - b)).toEqual(msg.seats);
  });

  it('even night: vision contains at least one GOOD seat', () => {
    // Night 1 passes (no divine), advance to night 2 (even) → good parity.
    let s = makeGame(['PSYCHIC', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = toNextNight(s); // now in NIGHT 2 (nightNumber === 2)
    expect(s.nightNumber).toBe(2);
    s = night(s, 0, 'divine', null);
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'psychic_vision');
    expect(eff).toBeDefined();
    const msg = eff!.msg as { parity?: string; seats?: number[] };
    expect(msg.parity).toBe('good');
    // The vision must contain at least one good seat (3, 4, or 5).
    const goodSeats = new Set([3, 4, 5]);
    expect(msg.seats!.some((seat) => goodSeats.has(seat))).toBe(true);
    expect(msg.seats).not.toContain(0);
  });

  it('is deterministic for a fixed seed (same vision twice)', () => {
    const build = () => {
      let g = makeGame(
        ['PSYCHIC', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN'],
        'psychic-seed',
      );
      g = toFirstNight(g);
      g = night(g, 0, 'divine', null);
      return resolveNightPhase(g).effects;
    };
    const a = privateResult(build(), 0, 'psychic_vision');
    const b = privateResult(build(), 0, 'psychic_vision');
    expect(JSON.stringify(a!.msg)).toEqual(JSON.stringify(b!.msg));
  });

  it('never reaches a seat other than the Psychic', () => {
    let s = makeGame(['PSYCHIC', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'divine', null);
    const { effects } = resolveNightPhase(s);
    for (const e of effects) {
      if ((e.msg as { kind?: string }).kind === 'psychic_vision') expect(e.to).toEqual([0]);
    }
  });
});

describe('batch C — Hypnotist (Mafia deception)', () => {
  it('plants a fake roleblocked feedback in the target (no real effect)', () => {
    // 0 Hypnotist (hypnotizes 2), 1 Godfather, 2 Sheriff (acts normally), 3..5 Citizen.
    let s = makeGame(['HYPNOTIST', 'GODFATHER', 'SHERIFF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'hypnotize', 2);
    s = night(s, 2, 'investigate_sheriff', 3); // sheriff still acts
    const { state, effects } = resolveNightPhase(s);

    // The target gets a fake roleblocked message.
    const fake = privateResult(effects, 2, 'roleblocked');
    expect(fake).toBeDefined();
    expect(fake!.to).toEqual([2]);
    const trace = state.traces.find((t) => t.step === 'hypnotize');
    expect(trace).toMatchObject({ step: 'hypnotize', hypnotist: 0, target: 2, fake: 'roleblocked' });

    // The sheriff's REAL action still resolved (their result was delivered).
    const real = privateResult(effects, 2, 'sheriff_result');
    expect(real).toBeDefined();
    expect((real!.msg as { target?: number }).target).toBe(3);
  });

  it('the fake message carries no seats and no roles', () => {
    let s = makeGame(['HYPNOTIST', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'hypnotize', 2);
    const { effects } = resolveNightPhase(s);
    const fake = privateResult(effects, 2, 'roleblocked');
    expect(fake).toBeDefined();
    const body = JSON.stringify(fake!.msg);
    expect(body).not.toMatch(/SHERIFF|GODFATHER|CITIZEN|HYPNOTIST/);
    // roleblocked is a bare kind — no target/seat fields.
    expect(Object.keys(fake!.msg as object).sort()).toEqual(['kind', 'type', 'v']);
  });
});
