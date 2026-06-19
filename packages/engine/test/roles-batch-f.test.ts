import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, step, resolveNightPhase, toNextNight } from './harness.js';
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

/** Submit a two-target night action (transport / witch_control). */
function night2(state: ReturnType<typeof makeGame>, seat: number, ability: string, a: number, b: number) {
  return step(state, { type: 'night_action', seat, ability: ability as never, target: a, target2: b } as never);
}

describe('batch F — Transporter (Town support; the bus-driver swap)', () => {
  it('redirects a kill on A onto B (kill-on-A-lands-on-B)', () => {
    // 0 Transporter (swaps 1 and 2), 1 Citizen (mafia target), 2 Citizen,
    // 3 Godfather (control), 4 Mafioso (kills 1), 5 Citizen.
    let s = makeGame(['TRANSPORTER', 'CITIZEN', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    s = night2(s, 0, 'transport', 1, 2); // swap seats 1 and 2
    s = night(s, 3, 'mafia_control', 1);
    s = night(s, 4, 'kill_mafia', 1); // aimed at seat 1...
    const { state } = resolveNightPhase(s);

    // ...lands on seat 2 (the swap partner). Seat 1 walks; seat 2 dies.
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[2]!.deathCause).toBe('mafia');

    const trace = state.traces.find((t) => t.step === 'transport');
    expect(trace).toMatchObject({ step: 'transport', transporter: 0, a: 1, b: 2, swapped: true });
  });

  it('redirects a Doctor heal: a heal on A actually shields B', () => {
    // 0 Transporter (swaps 1,2), 1 Citizen, 2 Citizen (mafia target),
    // 3 Doctor (heals 1 → really heals 2), 4 Godfather, 5 Mafioso (kills 2).
    let s = makeGame(['TRANSPORTER', 'CITIZEN', 'CITIZEN', 'DOCTOR', 'GODFATHER', 'MAFIOSO']);
    s = toFirstNight(s);
    s = night2(s, 0, 'transport', 1, 2);
    s = night(s, 3, 'protect', 1); // heal aimed at 1 → redirected to 2
    s = night(s, 4, 'mafia_control', 2);
    s = night(s, 5, 'kill_mafia', 2); // kill aimed at 2 → redirected to 1
    const { state } = resolveNightPhase(s);

    // The kill aimed at 2 lands on 1; the heal aimed at 1 shields 2. So seat 1
    // (unhealed, took the redirected kill) dies and seat 2 survives.
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[1]!.deathCause).toBe('mafia');
    expect(state.seats[2]!.alive).toBe(true);
  });

  it('redirects a visit: a Lookout watching A sees the callers of B', () => {
    // 0 Transporter (swaps 1,2), 1 Citizen, 2 Citizen, 3 Lookout (watches 1),
    // 4 Sheriff (visits 2), 5 Godfather.
    let s = makeGame(['TRANSPORTER', 'CITIZEN', 'CITIZEN', 'LOOKOUT', 'SHERIFF', 'GODFATHER']);
    s = toFirstNight(s);
    s = night2(s, 0, 'transport', 1, 2);
    s = night(s, 3, 'watch', 1); // watch aimed at 1 → watches 2
    s = night(s, 4, 'investigate_sheriff', 2); // sheriff visits 2 → visits 1
    const { effects } = resolveNightPhase(s);

    // The lookout's watch on 1 is swapped to 2; the sheriff's visit to 2 is
    // swapped to 1. So the lookout (now watching 2) sees nobody on 2's door, while
    // the swap is symmetric. Verify the lookout result exists and its `target`
    // reflects the swapped house.
    const lo = privateResult(effects, 3, 'lookout_result');
    expect(lo).toBeDefined();
    // The lookout's recorded target was rewritten to 2; the sheriff was rewritten
    // to visit 1, so the lookout watching 2 sees no callers there.
    expect((lo!.msg as { target?: number }).target).toBe(2);
  });

  it('the Transporter VISITS both swapped houses (a Lookout on either sees it)', () => {
    // 0 Transporter (swaps 2,3), 1 Lookout (watches 2), 2 Citizen, 3 Citizen,
    // 4 Godfather, 5 Citizen.
    let s = makeGame(['TRANSPORTER', 'LOOKOUT', 'CITIZEN', 'CITIZEN', 'GODFATHER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night2(s, 0, 'transport', 2, 3);
    s = night(s, 1, 'watch', 2);
    const { effects } = resolveNightPhase(s);
    const lo = privateResult(effects, 1, 'lookout_result');
    // The lookout watches 2; transport swaps the watch to 3. The Transporter visits
    // BOTH 2 and 3, so whichever house the lookout ends up on, seat 0 is a caller.
    expect((lo!.msg as { visitors?: number[] }).visitors).toContain(0);
  });

  it('a degenerate swap (A === B / self / dead endpoint) is a no-op', () => {
    let s = makeGame(['TRANSPORTER', 'CITIZEN', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    s = night2(s, 0, 'transport', 1, 1); // same seat twice
    s = night(s, 3, 'mafia_control', 1);
    s = night(s, 4, 'kill_mafia', 1);
    const { state } = resolveNightPhase(s);
    // No swap: the kill on 1 lands on 1.
    expect(state.seats[1]!.alive).toBe(false);
    const trace = state.traces.find((t) => t.step === 'transport');
    expect(trace).toMatchObject({ swapped: false });
  });

  it('interacts with the Witch: control resolves first, then transport swaps', () => {
    // The Witch (1) controls a Sheriff (2) onto victim 4; the Transporter (0) then
    // swaps 4 and 5, so the steered investigation lands on 5.
    let s = makeGame(['TRANSPORTER', 'WITCH', 'SHERIFF', 'GODFATHER', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night2(s, 1, 'witch_control', 2, 4); // witch rides sheriff (2) onto 4
    s = night2(s, 0, 'transport', 4, 5); // transporter swaps 4 and 5
    const { effects, state } = resolveNightPhase(s);

    // The sheriff's steered target (4) is swapped to 5 — the sheriff investigates 5.
    const sr = privateResult(effects, 2, 'sheriff_result');
    expect(sr).toBeDefined();
    expect((sr!.msg as { target?: number }).target).toBe(5);
    // Both steps are recorded; the witch trace (control) precedes the transport.
    const witchIdx = state.traces.findIndex((t) => t.step === 'witch');
    const transIdx = state.traces.findIndex((t) => t.step === 'transport');
    expect(witchIdx).toBeGreaterThanOrEqual(0);
    expect(transIdx).toBeGreaterThan(witchIdx);
  });

  it('is deterministic for a fixed seed (same outcome twice)', () => {
    const run = () => {
      let g = makeGame(['TRANSPORTER', 'CITIZEN', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN'], 'tp-seed');
      g = toFirstNight(g);
      g = night2(g, 0, 'transport', 1, 2);
      g = night(g, 3, 'mafia_control', 1);
      g = night(g, 4, 'kill_mafia', 1);
      return resolveNightPhase(g).state;
    };
    const a = run();
    const b = run();
    expect(a.seats.map((x) => x.alive)).toEqual(b.seats.map((x) => x.alive));
  });
});

describe('batch F — Coroner (Town investigative; autopsy the dead)', () => {
  it('learns a dead seat exact role AND the seats that visited it the night it died', () => {
    // Night 1: the Mafia kills seat 4 (a Doctor visits it too, so 4 has visitors).
    // 0 Coroner, 1 Godfather, 2 Mafioso (kills 4), 3 Doctor (visits 4 — fails to
    // save, no heal), 4 Citizen (victim), 5 Lookout.
    let s = makeGame(['CORONER', 'GODFATHER', 'MAFIOSO', 'SHERIFF', 'CITIZEN', 'LOOKOUT']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 4);
    s = night(s, 2, 'kill_mafia', 4);
    s = night(s, 3, 'investigate_sheriff', 4); // a visitor to the dying seat
    s = toNextNight(s); // resolve N1 (seat 4 dies) and advance to N2

    // Night 2: the Coroner autopsies the dead seat 4.
    s = night(s, 0, 'autopsy', 4);
    const { state, effects } = resolveNightPhase(s);

    const eff = privateResult(effects, 0, 'coroner_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]);
    const msg = eff!.msg as { target?: number; role?: string; visitors?: number[] };
    expect(msg.target).toBe(4);
    expect(msg.role).toBe('CITIZEN'); // the dead seat's true role
    // The killer (seat 2, the Mafioso performer) and the sheriff (seat 3) visited.
    expect(msg.visitors).toContain(2);
    expect(msg.visitors).toContain(3);
    // Visitors are sorted.
    expect(msg.visitors!.slice().sort((a, b) => a - b)).toEqual(msg.visitors);

    const trace = state.traces.find((t) => t.step === 'autopsy' && t.read === true);
    expect(trace).toMatchObject({ step: 'autopsy', coroner: 0, target: 4, read: true });
  });

  it('fails on a LIVING target (no valid corpse to open)', () => {
    let s = makeGame(['CORONER', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'autopsy', 2); // seat 2 is alive
    const { state, effects } = resolveNightPhase(s);
    expect(privateResult(effects, 0, 'coroner_result')).toBeUndefined();
    const trace = state.traces.find((t) => t.step === 'autopsy');
    expect(trace).toMatchObject({ read: false });
  });

  it('the result is delivered ONLY to the Coroner', () => {
    let s = makeGame(['CORONER', 'GODFATHER', 'MAFIOSO', 'SHERIFF', 'CITIZEN', 'LOOKOUT']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 4);
    s = night(s, 2, 'kill_mafia', 4);
    s = toNextNight(s);
    s = night(s, 0, 'autopsy', 4);
    const { effects } = resolveNightPhase(s);
    for (const e of effects) {
      if ((e.msg as { kind?: string }).kind === 'coroner_result') expect(e.to).toEqual([0]);
    }
  });
});

describe('batch F — Trapper (Town protective; snare that shields + names, never kills)', () => {
  it('shields its ward from one basic attack AND names the lowest-seat caller', () => {
    // 0 Trapper (rigs 1), 1 Citizen (ward, mafia target), 2 Godfather (control),
    // 3 Mafioso (kills 1), 4 Sheriff (also visits 1), 5 Citizen.
    let s = makeGame(['TRAPPER', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'SHERIFF', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'trap', 1);
    s = night(s, 2, 'mafia_control', 1);
    s = night(s, 3, 'kill_mafia', 1);
    s = night(s, 4, 'investigate_sheriff', 1);
    const { state, effects } = resolveNightPhase(s);

    // The ward (1) survives — the trap absorbed the basic attack.
    expect(state.seats[1]!.alive).toBe(true);
    // The Trapper does NOT kill: the caught caller (the Mafioso, seat 3) is ALIVE.
    expect(state.seats[3]!.alive).toBe(true);
    expect(state.seats[4]!.alive).toBe(true);

    // The Trapper learns the lowest-seat caller's SEAT (seat 3, the Mafioso).
    const eff = privateResult(effects, 0, 'trapper_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]);
    const msg = eff!.msg as { target?: number; caught?: number };
    expect(msg.target).toBe(1);
    expect(msg.caught).toBe(3); // lowest-seat visitor (excluding ward + Trapper)
    // Carries no role strings.
    expect(JSON.stringify(eff!.msg)).not.toMatch(/MAFIOSO|SHERIFF|CITIZEN|GODFATHER|TRAPPER/);

    const trace = state.traces.find((t) => t.step === 'trap');
    expect(trace).toMatchObject({ step: 'trap', trapper: 0, ward: 1, caught: 3, sprung: true });
  });

  it('names a caller even when the ward is not attacked (sprung: false)', () => {
    // 0 Trapper (rigs 1), 1 Citizen (ward), 2 Sheriff (visits 1), 3 Godfather,
    // 4..5 Citizen. No attack on the ward.
    let s = makeGame(['TRAPPER', 'CITIZEN', 'SHERIFF', 'GODFATHER', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'trap', 1);
    s = night(s, 2, 'investigate_sheriff', 1);
    const { state, effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'trapper_result');
    expect((eff!.msg as { caught?: number }).caught).toBe(2);
    const trace = state.traces.find((t) => t.step === 'trap');
    expect(trace).toMatchObject({ caught: 2, sprung: false });
  });

  it('catches nobody when no one calls on the ward (no result, only a trace)', () => {
    let s = makeGame(['TRAPPER', 'CITIZEN', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'trap', 1);
    const { state, effects } = resolveNightPhase(s);
    expect(privateResult(effects, 0, 'trapper_result')).toBeUndefined();
    const trace = state.traces.find((t) => t.step === 'trap');
    expect(trace).toMatchObject({ ward: 1, caught: null, sprung: false });
    for (const seat of state.seats) expect(seat.alive).toBe(true);
  });
});
