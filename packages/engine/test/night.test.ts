import { describe, it, expect } from 'vitest';
import {
  makeGame,
  toFirstNight,
  night,
  resolveNightPhase,
  endPhase,
} from './harness.js';
import type { GameState } from '../src/index.js';

/** Helper: set jailor's day-jail target before night by faking jailTarget. */
function jail(state: GameState, jailorSeat: number, prisoner: number): GameState {
  // Use day_ability during a day phase. For night tests we set directly: jailor
  // selects during DAY_0/discussion. Easiest: drive via day_ability on DAY_0 is
  // disallowed (no jail on Day 0). Set jailTarget directly for unit isolation.
  const s = structuredClone(state);
  s.jailTarget = prisoner;
  void jailorSeat;
  return s;
}

describe('§6.8 night resolution — golden cases', () => {
  it('jail blocks a roleblock-immune target (Godfather), pierces all', () => {
    // seats: 0 Jailor, 1 Godfather, 2 Mafioso, 3 Citizen, 4 Doctor
    let s = makeGame(['JAILOR', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    s = jail(s, 0, 1); // jail the Godfather
    // GF tries to control a mafia kill on citizen; Mafioso performs.
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3); // mafioso performs kill on citizen 3
    const { state } = resolveNightPhase(s);
    // GF jailed: his control intent removed; but mafioso still acted (not jailed).
    // The jail trace exists; GF could not act.
    const jailTrace = state.traces.find((t) => t.step === 'jail');
    expect(jailTrace).toEqual({ step: 'jail', jailor: 0, prisoner: 1 });
    // Citizen still dies (mafioso performed).
    expect(state.seats[3]!.alive).toBe(false);
    // Godfather is alive (jailed = protected).
    expect(state.seats[1]!.alive).toBe(true);
  });

  it('jailor execution pierces a doctor heal', () => {
    // 0 Jailor, 1 Doctor, 2 Citizen
    let s = makeGame(['JAILOR', 'DOCTOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = jail(s, 0, 2); // jail citizen 2
    s = night(s, 0, 'kill_jailor', 2); // execute prisoner
    s = night(s, 1, 'protect', 2); // doctor heals the prisoner
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.alive).toBe(false);
    const kt = state.traces.find((t) => t.step === 'kill' && t.target === 2);
    expect(kt).toMatchObject({ step: 'kill', source: 'jailor_execute', outcome: 'died' });
  });

  it('two simultaneous kills overwhelm one heal', () => {
    // 0 Doctor, 1 Vigilante, 2 Mafioso, 3 Godfather, 4 Citizen(victim)
    let s = makeGame(['DOCTOR', 'VIGILANTE', 'MAFIOSO', 'GODFATHER', 'CITIZEN']);
    s = toFirstNight(s);
    s.nightNumber = 2; // allow vigilante to shoot (not N1)
    s = night(s, 0, 'protect', 4); // heal victim
    s = night(s, 1, 'kill_vigilante', 4);
    s = night(s, 3, 'mafia_control', 4);
    s = night(s, 2, 'kill_mafia', 4);
    const { state } = resolveNightPhase(s);
    // One kill healed, the other lands.
    expect(state.seats[4]!.alive).toBe(false);
    const kills = state.traces.filter((t) => t.step === 'kill' && t.target === 4);
    const healed = kills.filter((k) => k.step === 'kill' && k.outcome === 'healed');
    const died = kills.filter((k) => k.step === 'kill' && k.outcome === 'died');
    expect(healed).toHaveLength(1);
    expect(died).toHaveLength(1);
  });

  it('SK kills his roleblocker (Escort variant); original target survives', () => {
    // 0 SK, 1 Escort, 2 Citizen(original target)
    let s = makeGame(['SERIAL_KILLER', 'ESCORT', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'kill_serial', 2);
    s = night(s, 1, 'roleblock', 0); // escort blocks SK
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false); // escort dies
    expect(state.seats[2]!.alive).toBe(true); // original target survives
    const redirect = state.traces.find((t) => t.step === 'sk_redirect');
    expect(redirect).toMatchObject({ step: 'sk_redirect', sk: 0, blocker: 1, originalTarget: 2 });
  });

  it('SK kills his roleblocker (Consort variant)', () => {
    let s = makeGame(['SERIAL_KILLER', 'CONSORT', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'kill_serial', 2);
    s = night(s, 1, 'roleblock', 0);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[2]!.alive).toBe(true);
  });

  it('blocker cycle A↔B fixed point: both blocked', () => {
    // 0 Escort, 1 Consort each block the other; both actions cancelled.
    // Add a target seat 2 each would have blocked otherwise; here they block
    // each other. Add a sheriff(2) the escort would NOT touch — irrelevant.
    let s = makeGame(['ESCORT', 'CONSORT', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'roleblock', 1);
    s = night(s, 1, 'roleblock', 0);
    const { state } = resolveNightPhase(s);
    const blocks = state.traces.filter((t) => t.step === 'roleblock');
    // Both blocks active (both seats blocked) per §6.7 cycle rule.
    expect(blocks.filter((b) => b.step === 'roleblock' && b.outcome === 'blocked')).toHaveLength(2);
  });

  it('blocker chain A→B→C: B blocked ⇒ C is unblocked (C acts)', () => {
    // 0 Escort blocks 1; 1 Consort blocks 2 (Escort); 2 Escort blocks 3 (Sheriff).
    // B (seat1) is blocked by A (seat0), so B's block on C is cancelled ⇒ C (seat2)
    // is NOT blocked and its block on seat3 IS active.
    let s = makeGame(['ESCORT', 'CONSORT', 'ESCORT', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'roleblock', 1);
    s = night(s, 1, 'roleblock', 2);
    s = night(s, 2, 'roleblock', 3);
    s = night(s, 3, 'investigate_sheriff', 0);
    const { state } = resolveNightPhase(s);
    const blocks = state.traces.filter((t) => t.step === 'roleblock' && t.outcome === 'blocked');
    const blockedTargets = blocks.map((b) => (b.step === 'roleblock' ? b.target : -1)).sort();
    // seat1 blocked (by 0); seat3 blocked (by 2). seat2 NOT blocked.
    expect(blockedTargets).toEqual([1, 3]);
    // Sheriff (seat3) was blocked ⇒ no sheriff result trace.
    expect(state.traces.some((t) => t.step === 'investigate' && t.kind === 'sheriff')).toBe(false);
  });

  it('framed citizen reads suspicious to Sheriff and R6 to Investigator; frame expires next night', () => {
    // 0 Framer, 1 Sheriff, 2 Investigator, 3 Citizen(victim of frame)
    let s = makeGame(['FRAMER', 'SHERIFF', 'INVESTIGATOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'frame', 3);
    s = night(s, 1, 'investigate_sheriff', 3);
    s = night(s, 2, 'investigate_investigator', 3);
    const r1 = resolveNightPhase(s);
    const sheriff = r1.state.traces.find((t) => t.step === 'investigate' && t.kind === 'sheriff');
    expect(sheriff).toMatchObject({ result: 'suspicious' });
    const inv = r1.state.traces.find((t) => t.step === 'investigate' && t.kind === 'investigator');
    expect(inv).toMatchObject({ result: 'R6' });

    // Next night: no frame ⇒ citizen reads not_suspicious / R1.
    let s2 = r1.state;
    // Drive to next night: DAWN → DAY_DISCUSSION → DAY_VOTING → (timeout) NIGHT
    s2 = endPhase(s2).state; // DAWN -> DAY_DISCUSSION
    s2 = endPhase(s2).state; // DAY_DISCUSSION -> DAY_VOTING
    s2 = endPhase(s2).state; // DAY_VOTING -> NIGHT (no lynch)
    s2 = night(s2, 1, 'investigate_sheriff', 3);
    s2 = night(s2, 2, 'investigate_investigator', 3);
    const r2 = resolveNightPhase(s2);
    const sheriff2 = [...r2.state.traces].reverse().find((t) => t.step === 'investigate' && t.kind === 'sheriff');
    expect(sheriff2).toMatchObject({ result: 'not_suspicious' });
    const inv2 = [...r2.state.traces].reverse().find((t) => t.step === 'investigate' && t.kind === 'investigator');
    expect(inv2).toMatchObject({ result: 'R1' });
  });

  it('Godfather reads not-suspicious to Sheriff', () => {
    let s = makeGame(['SHERIFF', 'GODFATHER', 'MAFIOSO']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_sheriff', 1);
    const { state } = resolveNightPhase(s);
    const sheriff = state.traces.find((t) => t.step === 'investigate' && t.kind === 'sheriff');
    expect(sheriff).toMatchObject({ target: 1, result: 'not_suspicious' });
  });

  it("dead vigilante's queued shot still lands (dead men's knives)", () => {
    // Vigilante and Mafioso shoot each other the same night; both die, both kills land.
    // 0 Vigilante, 1 Mafioso, 2 Godfather
    let s = makeGame(['VIGILANTE', 'MAFIOSO', 'GODFATHER']);
    s = toFirstNight(s);
    s.nightNumber = 2; // not N1
    s = night(s, 0, 'kill_vigilante', 1); // vigilante shoots mafioso
    s = night(s, 2, 'mafia_control', 0);
    s = night(s, 1, 'kill_mafia', 0); // mafioso shoots vigilante
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(false);
    expect(state.seats[1]!.alive).toBe(false);
  });

  it('Doctor self-heal works once', () => {
    // 0 Doctor, 1 Mafioso, 2 Godfather
    let s = makeGame(['DOCTOR', 'MAFIOSO', 'GODFATHER']);
    s = toFirstNight(s);
    s = night(s, 0, 'protect', 0); // self-heal
    s = night(s, 2, 'mafia_control', 0);
    s = night(s, 1, 'kill_mafia', 0);
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true);
    expect(state.seats[0]!.selfUsesRemaining).toBe(0);
  });

  it('Survivor vest grants night immunity and decrements', () => {
    let s = makeGame(['SURVIVOR', 'MAFIOSO', 'GODFATHER']);
    s = toFirstNight(s);
    s = night(s, 0, 'vest', null);
    s = night(s, 2, 'mafia_control', 0);
    s = night(s, 1, 'kill_mafia', 0);
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true);
    expect(state.seats[0]!.usesRemaining).toBe(3);
  });

  it('Lookout sees post-block visitors; mafia kill attributed to performer', () => {
    // 0 Lookout watches 4; 1 Mafioso kills 4; 2 Godfather controls; 3 Doctor heals 4.
    let s = makeGame(['LOOKOUT', 'MAFIOSO', 'GODFATHER', 'DOCTOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'watch', 4);
    s = night(s, 2, 'mafia_control', 4);
    s = night(s, 1, 'kill_mafia', 4);
    s = night(s, 3, 'protect', 4);
    const { state } = resolveNightPhase(s);
    const lo = state.traces.find((t) => t.step === 'investigate' && t.kind === 'lookout');
    // Visitors: mafioso(1, performer) and doctor(3). GF does not visit.
    expect(lo).toMatchObject({ step: 'investigate', kind: 'lookout', target: 4 });
    if (lo && lo.step === 'investigate' && lo.kind === 'lookout') {
      expect(lo.visitors).toEqual([1, 3]);
    }
  });
});
