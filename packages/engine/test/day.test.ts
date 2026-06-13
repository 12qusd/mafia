import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, step, endPhase } from './harness.js';
import type { GameState } from '../src/index.js';

function jailDirect(state: GameState, prisoner: number): GameState {
  const s = structuredClone(state);
  s.jailTarget = prisoner;
  return s;
}

/** Drive a state from DAWN forward to the next NIGHT (no lynch). */
function dawnToNight(state: GameState): GameState {
  let s = state;
  s = endPhase(s).state; // DAWN -> DAY_DISCUSSION
  s = endPhase(s).state; // DAY_DISCUSSION -> DAY_VOTING
  s = endPhase(s).state; // DAY_VOTING -> NIGHT (no lynch)
  return s;
}

describe('§6.3 day / trial / voting', () => {
  it('Mayor reveal sets weight 3 and becomes unhealable', () => {
    // 0 Mayor, 1 Doctor, 2 Mafioso, 3 Godfather
    let s = makeGame(['MAYOR', 'DOCTOR', 'MAFIOSO', 'GODFATHER']);
    s = endPhase(s).state; // ASSIGN -> DAY_0
    // Mayor can't reveal Day 0? Reveal allowed any day phase incl DAY_0.
    s = step(s, { type: 'day_ability', seat: 0, ability: 'reveal' });
    expect(s.seats[0]!.mayorRevealed).toBe(true);
    // Go to night; doctor tries to heal the revealed mayor; mafia kills mayor.
    s = endPhase(s).state; // DAY_0 -> NIGHT
    s = night(s, 1, 'protect', 0);
    s = night(s, 3, 'mafia_control', 0);
    s = night(s, 2, 'kill_mafia', 0);
    const { state } = resolveNightPhase(s);
    // Mayor is unhealable ⇒ dies despite doctor.
    expect(state.seats[0]!.alive).toBe(false);
  });

  it('nomination majority puts a seat on trial; guilty ⇒ execution', () => {
    // 5 town vs nothing — simple lynch flow. 0..4 citizens-ish.
    let s = makeGame(['SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'MAFIOSO']);
    s = endPhase(s).state; // DAY_0
    s = endPhase(s).state; // NIGHT
    s = night(s, 4, 'kill_mafia', null); // no kill
    s = resolveNightPhase(s).state; // -> DAWN
    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION
    s = endPhase(s).state; // -> DAY_VOTING
    // Living weight = 5, threshold = floor(5/2)+1 = 3. Vote seat 4.
    s = step(s, { type: 'vote', seat: 0, target: 4 });
    s = step(s, { type: 'vote', seat: 1, target: 4 });
    s = step(s, { type: 'vote', seat: 2, target: 4 });
    expect(s.phase).toBe('TRIAL_DEFENSE');
    s = endPhase(s).state; // -> TRIAL_JUDGMENT
    s = step(s, { type: 'verdict', seat: 0, value: 'guilty' });
    s = step(s, { type: 'verdict', seat: 1, value: 'guilty' });
    s = step(s, { type: 'verdict', seat: 2, value: 'guilty' });
    s = endPhase(s).state; // judgment -> EXECUTION
    expect(s.phase).toBe('EXECUTION');
    s = endPhase(s).state; // EXECUTION -> (win check) -> NIGHT or GAME_OVER
    expect(s.seats[4]!.alive).toBe(false);
  });

  it('innocent verdict resumes DAY_VOTING; 3 innocents end the day', () => {
    let s = makeGame(['CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'MAFIOSO']);
    s = endPhase(s).state; // DAY_0
    s = endPhase(s).state; // NIGHT
    s = night(s, 4, 'kill_mafia', null);
    s = resolveNightPhase(s).state; // DAWN
    s = endPhase(s).state; // DAY_DISCUSSION
    s = endPhase(s).state; // DAY_VOTING
    // Run 3 trials, all innocent.
    for (let trial = 0; trial < 3; trial++) {
      s = step(s, { type: 'vote', seat: 0, target: 4 });
      s = step(s, { type: 'vote', seat: 1, target: 4 });
      s = step(s, { type: 'vote', seat: 2, target: 4 });
      expect(s.phase).toBe('TRIAL_DEFENSE');
      s = endPhase(s).state; // TRIAL_JUDGMENT
      // all innocent
      s = step(s, { type: 'verdict', seat: 0, value: 'innocent' });
      s = step(s, { type: 'verdict', seat: 1, value: 'innocent' });
      s = endPhase(s).state; // back to DAY_VOTING or NIGHT
    }
    // After 3rd innocent the day ends → NIGHT.
    expect(s.phase).toBe('NIGHT');
  });

  it('Jester lynch ⇒ a random guilty voter dies unhealably the next night', () => {
    // 0 Jester, 1..3 town voters, 4 Doctor, 5 Mafioso, 6 Godfather (keep game live)
    let s = makeGame(['JESTER', 'CITIZEN', 'CITIZEN', 'SHERIFF', 'DOCTOR', 'MAFIOSO', 'GODFATHER']);
    s = endPhase(s).state; // DAY_0
    s = endPhase(s).state; // NIGHT
    s = resolveNightPhase(s).state; // DAWN
    s = endPhase(s).state; // DAY_DISCUSSION
    s = endPhase(s).state; // DAY_VOTING
    // Vote the jester. weight 7, threshold 4.
    s = step(s, { type: 'vote', seat: 1, target: 0 });
    s = step(s, { type: 'vote', seat: 2, target: 0 });
    s = step(s, { type: 'vote', seat: 3, target: 0 });
    s = step(s, { type: 'vote', seat: 4, target: 0 });
    expect(s.phase).toBe('TRIAL_DEFENSE');
    s = endPhase(s).state; // JUDGMENT
    s = step(s, { type: 'verdict', seat: 1, value: 'guilty' });
    s = step(s, { type: 'verdict', seat: 2, value: 'guilty' });
    s = step(s, { type: 'verdict', seat: 3, value: 'guilty' });
    s = endPhase(s).state; // EXECUTION
    s = endPhase(s).state; // after execution -> NIGHT (jester dead)
    expect(s.seats[0]!.alive).toBe(false);
    expect(s.jesterWinners).toContain(0);
    expect(s.pendingJesterGrief).not.toBeNull();
    // Next night: a guilty voter dies despite doctor heal.
    expect(s.phase).toBe('NIGHT');
    // Doctor heals everyone possible (heal seat 1).
    s = night(s, 4, 'protect', 1);
    const { state } = resolveNightPhase(s);
    const griefKill = state.traces.find((t) => t.step === 'kill' && t.source === 'jester_grief');
    expect(griefKill).toMatchObject({ outcome: 'died' });
    // The grief victim is one of the guilty voters (1,2,3).
    const dead = state.seats.filter((x) => !x.alive).map((x) => x.seat);
    expect(dead.some((d) => [1, 2, 3].includes(d))).toBe(true);
  });

  it('Executioner whose target dies at night becomes a Jester', () => {
    // 0 Executioner (target = 1), 1 Citizen, 2 Mafioso, 3 Godfather
    let s = makeGame(['EXECUTIONER', 'CITIZEN', 'MAFIOSO', 'GODFATHER']);
    s.seats[0]!.exeTarget = 1;
    s = toFirstNight(s);
    s = night(s, 3, 'mafia_control', 1);
    s = night(s, 2, 'kill_mafia', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[0]!.role).toBe('JESTER');
    expect(state.seats[0]!.faction).toBe('NEUTRAL_BENIGN');
    const conv = state.traces.find((t) => t.step === 'promotion' && t.kind === 'executioner_to_jester');
    expect(conv).toBeTruthy();
  });

  it('mafia succession: GF + Mafioso both die ⇒ senior mafia becomes Mafioso', () => {
    // 0 Godfather, 1 Consort, 2 Framer, 3 Vigilante, 4 Citizen
    let s = makeGame(['GODFATHER', 'CONSORT', 'FRAMER', 'VIGILANTE', 'CITIZEN']);
    s = toFirstNight(s);
    s.nightNumber = 2;
    // Vigilante shoots the Godfather (night-immune!) — won't die. Use jailor exec
    // instead: simpler to kill GF via two vigil... GF is night-immune. Instead,
    // simulate GF already dead and no mafioso: kill consort? We need GF dead +
    // no mafioso. There is no mafioso here. Kill the GF via lynch path is complex;
    // directly mark GF dead to test succession trigger at next resolution.
    s.seats[0]!.alive = false;
    s.seats[0]!.revealed = true;
    // A quiet night triggers the succession bookkeeping.
    const { state } = resolveNightPhase(s);
    // Senior living mafia = lowest seat = Consort(1) becomes Mafioso.
    expect(state.seats[1]!.role).toBe('MAFIOSO');
    const succ = state.traces.find((t) => t.step === 'promotion' && t.kind === 'mafia_succession');
    expect(succ).toMatchObject({ seat: 1, newRole: 'MAFIOSO' });
  });

  it('leaver suicides at next night resolution (unpreventable, queued kills land)', () => {
    // 0 leaver Mafioso (queues a kill), 1 Godfather, 2 Citizen, 3 Doctor
    let s = makeGame(['MAFIOSO', 'GODFATHER', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    // Mafioso queues a kill on citizen, then leaves.
    s = night(s, 1, 'mafia_control', 2);
    s = night(s, 0, 'kill_mafia', 2);
    s = step(s, { type: 'seat_left', seat: 0 });
    // Doctor heals the leaver — should not save them.
    s = night(s, 3, 'protect', 0);
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(false); // leaver dies
    expect(state.seats[2]!.alive).toBe(false); // queued kill still lands
    void jailDirect;
    void dawnToNight;
  });
});
