import { describe, it, expect } from 'vitest';
import {
  makeGame,
  toFirstNight,
  night,
  step,
  ev,
  endPhase,
  resolveNightPhase,
} from './harness.js';
import type { Effect } from '@nocturne/shared';
import type { GameState } from '../src/index.js';

/** Collect day-channel chat_message effects from an apply result. */
function dayChatFrom(effects: Effect[], seat: number) {
  return effects.filter(
    (e) =>
      (e.msg as { type?: string }).type === 'chat_message' &&
      (e.msg as { channel?: string }).channel === 'day' &&
      (e.msg as { from?: number }).from === seat,
  );
}

/** Find the public death_announce effect for `seat`. */
function deathAnnounce(effects: Effect[], seat: number) {
  return effects.find(
    (e) =>
      e.to === 'public' &&
      (e.msg as { type?: string }).type === 'death_announce' &&
      (e.msg as { seat?: number }).seat === seat,
  );
}

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

describe('batch A — Consigliere (Mafia exact investigate)', () => {
  it('learns the target\'s exact role, addressed only to the consigliere', () => {
    // 0 Consigliere, 1 Godfather, 2 Doctor (the mark)
    let s = makeGame(['CONSIGLIERE', 'GODFATHER', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_consigliere', 2);
    const { state, effects } = resolveNightPhase(s);

    const trace = state.traces.find(
      (t) => t.step === 'investigate' && t.kind === 'consigliere',
    );
    expect(trace).toMatchObject({
      step: 'investigate',
      kind: 'consigliere',
      investigator: 0,
      target: 2,
      result: 'DOCTOR',
    });

    const eff = privateResult(effects, 0, 'consigliere_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]); // addressed ONLY to the consigliere (§5)
    expect(eff!.msg).toMatchObject({ kind: 'consigliere_result', target: 2, role: 'DOCTOR' });
  });

  it('reads the TRUE role even when the target is framed', () => {
    // 0 Consigliere, 1 Framer, 2 Citizen (framed mark)
    let s = makeGame(['CONSIGLIERE', 'FRAMER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'frame', 2);
    s = night(s, 0, 'investigate_consigliere', 2);
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'consigliere_result');
    // Framing fogs sheriff/investigator only; the consigliere sees CITIZEN.
    expect(eff!.msg).toMatchObject({ role: 'CITIZEN' });
  });

  it('result never reaches a seat other than the consigliere', () => {
    let s = makeGame(['CONSIGLIERE', 'GODFATHER', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_consigliere', 2);
    const { effects } = resolveNightPhase(s);
    for (const e of effects) {
      if ((e.msg as { kind?: string }).kind === 'consigliere_result') {
        expect(e.to).toEqual([0]);
      }
    }
  });
});

describe('batch A — Forger (Mafia counterfeit will)', () => {
  it('replaces the victim\'s last will with the forged text when the mark dies', () => {
    // 0 Forger, 1 Godfather, 2 Mafioso, 3 Citizen (the mark), 4..7 Citizen (enough
    // town that the game does not end on parity before DAWN composes the reveal).
    let s = makeGame([
      'FORGER',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    // Victim writes a real will; forger prepares a counterfeit in its death note.
    s = step(s, { type: 'last_will', seat: 3, text: 'The Mafia is seat 1.' });
    s = step(s, { type: 'death_note', seat: 0, text: 'I, the Doctor, accuse seat 2.' });
    // Forge the citizen; the mafia kills the same citizen.
    s = night(s, 0, 'forge', 3);
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(false);
    const da = deathAnnounce(effects, 3);
    expect(da).toBeDefined();
    // Public reveal shows the FORGED will, not the victim's real one.
    expect((da!.msg as { lastWill?: string }).lastWill).toBe('I, the Doctor, accuse seat 2.');
    const forge = state.traces.find((t) => t.step === 'forge');
    expect(forge).toMatchObject({ step: 'forge', forger: 0, target: 3, applied: true });
  });

  it('does nothing when the forged mark survives the night', () => {
    // 0 Forger, 1 Godfather, 2 Mafioso, 3 Citizen (forged), 4 Citizen (victim),
    // 5/6 Citizen (so the town survives and the game continues past DAWN).
    let s = makeGame([
      'FORGER',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s = step(s, { type: 'last_will', seat: 3, text: 'My real will.' });
    s = step(s, { type: 'death_note', seat: 0, text: 'A forgery that never lands.' });
    s = night(s, 0, 'forge', 3); // forge seat 3
    s = night(s, 1, 'mafia_control', 4); // kill a DIFFERENT seat
    s = night(s, 2, 'kill_mafia', 4);
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(true); // mark survived
    expect(deathAnnounce(effects, 3)).toBeUndefined();
    const forge = state.traces.find((t) => t.step === 'forge');
    expect(forge).toMatchObject({ step: 'forge', forger: 0, target: 3, applied: false });
  });
});

describe('batch A — Janitor (Mafia body cleaning)', () => {
  // 0 Janitor, 1 Godfather, 2 Mafioso, 3 Citizen (the mark/victim), 4..7 Citizen.
  const ROSTER = [
    'JANITOR',
    'GODFATHER',
    'MAFIOSO',
    'CITIZEN',
    'CITIZEN',
    'CITIZEN',
    'CITIZEN',
    'CITIZEN',
  ] as const;

  it('cleans the mafia-kill victim: public reveal hides role + will; janitor learns them', () => {
    let s = makeGame([...ROSTER]);
    s = toFirstNight(s);
    s = step(s, { type: 'last_will', seat: 3, text: 'I name the Godfather.' });
    s = night(s, 0, 'clean', 3); // janitor marks seat 3
    s = night(s, 1, 'mafia_control', 3); // mafia kill lands on seat 3
    s = night(s, 2, 'kill_mafia', 3);
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(false);
    const da = deathAnnounce(effects, 3);
    expect(da).toBeDefined();
    // Public reveal: cleaned — no role, no will.
    expect((da!.msg as { cleaned?: boolean }).cleaned).toBe(true);
    expect((da!.msg as { role?: string }).role).toBeUndefined();
    expect((da!.msg as { lastWill?: string }).lastWill).toBeUndefined();
    // The cleaned seat is NOT legally revealed publicly.
    expect(state.seats[3]!.revealed).toBe(false);

    // The janitor privately learns the scrubbed role + will.
    const jr = privateResult(effects, 0, 'janitor_result');
    expect(jr).toBeDefined();
    expect(jr!.to).toEqual([0]);
    expect(jr!.msg).toMatchObject({ kind: 'janitor_result', target: 3, role: 'CITIZEN' });
    expect((jr!.msg as { lastWill?: string }).lastWill).toBe('I name the Godfather.');

    const clean = state.traces.find((t) => t.step === 'clean');
    expect(clean).toMatchObject({ step: 'clean', janitor: 0, target: 3, applied: true });
    // One cleaning consumed (3 → 2).
    expect(state.seats[0]!.usesRemaining).toBe(2);
  });

  it('does not clean when the victim dies to a NON-mafia source (e.g. vigilante)', () => {
    // 0 Janitor, 1 Godfather, 2 Mafioso, 3 Citizen (marked), 4 Vigilante, 5..7 Citizen.
    let s = makeGame([
      'JANITOR',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'VIGILANTE',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s.nightNumber = 2; // allow the vigilante to shoot (not N1)
    s = night(s, 0, 'clean', 3); // janitor marks seat 3
    s = night(s, 4, 'kill_vigilante', 3); // vigilante (not mafia) kills seat 3
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(false);
    const da = deathAnnounce(effects, 3);
    // NOT cleaned: the normal reveal shows the role.
    expect((da!.msg as { cleaned?: boolean }).cleaned).toBeUndefined();
    expect((da!.msg as { role?: string }).role).toBe('CITIZEN');
    const clean = state.traces.find((t) => t.step === 'clean');
    expect(clean).toMatchObject({ step: 'clean', janitor: 0, target: 3, applied: false });
    // Use NOT consumed when the cleaning didn't land.
    expect(state.seats[0]!.usesRemaining).toBe(3);
  });

  it('does nothing when the marked seat is not killed at all', () => {
    let s = makeGame([...ROSTER]);
    s = toFirstNight(s);
    s = night(s, 0, 'clean', 3); // mark seat 3
    s = night(s, 1, 'mafia_control', 4); // mafia kills a different seat
    s = night(s, 2, 'kill_mafia', 4);
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.alive).toBe(true);
    const clean = state.traces.find((t) => t.step === 'clean');
    expect(clean).toMatchObject({ applied: false });
    expect(state.seats[0]!.usesRemaining).toBe(3);
  });
});

describe('batch A — Bodyguard (Town protective trade)', () => {
  it('trades with the attacker: ward survives, bodyguard dies, non-immune attacker dies', () => {
    // 0 Bodyguard (guards 3), 1 Godfather, 2 Mafioso (attacker), 3 Citizen (ward),
    // 4..6 Citizen so the game continues past DAWN.
    let s = makeGame([
      'BODYGUARD',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s = night(s, 0, 'guard', 3); // bodyguard guards the citizen
    s = night(s, 1, 'mafia_control', 3); // mafia targets the ward
    s = night(s, 2, 'kill_mafia', 3);
    const { state } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(true); // ward survives
    expect(state.seats[0]!.alive).toBe(false); // bodyguard dies in their place
    expect(state.seats[2]!.alive).toBe(false); // the (non-immune) mafioso dies
    const guard = state.traces.find((t) => t.step === 'guard');
    expect(guard).toMatchObject({
      step: 'guard',
      bodyguard: 0,
      ward: 3,
      attacker: 2,
      killedAttacker: true,
    });
  });

  it('a night-immune attacker (Godfather performing) survives the counter, but the ward still lives', () => {
    // Here the Godfather performs the kill himself (night-immune). The bodyguard
    // still dies and saves the ward, but the GF shrugs off the counterattack.
    // 0 Bodyguard (guards 3), 1 Godfather (attacker), 2 Citizen, 3 Citizen (ward),
    // 4..6 Citizen.
    let s = makeGame([
      'BODYGUARD',
      'GODFATHER',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    // No Mafioso ⇒ GF is promoted at succession only AFTER a night; to have the GF
    // perform the kill directly we drive a kill_mafia from the GF seat (the engine
    // treats the kill_mafia performer as the attacker; the GF is night-immune).
    s = night(s, 0, 'guard', 3);
    s = night(s, 1, 'kill_mafia', 3); // GF performs the basic mafia attack on the ward
    const { state } = resolveNightPhase(s);

    expect(state.seats[3]!.alive).toBe(true); // ward survives
    expect(state.seats[0]!.alive).toBe(false); // bodyguard dies
    expect(state.seats[1]!.alive).toBe(true); // night-immune GF survives the counter
    const guard = state.traces.find((t) => t.step === 'guard');
    expect(guard).toMatchObject({ step: 'guard', bodyguard: 0, ward: 3, killedAttacker: false });
  });

  it('does nothing when the ward is not attacked', () => {
    let s = makeGame([
      'BODYGUARD',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s = night(s, 0, 'guard', 3); // guard seat 3
    s = night(s, 1, 'mafia_control', 4); // mafia attacks a different seat
    s = night(s, 2, 'kill_mafia', 4);
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true); // bodyguard untouched
    expect(state.seats[3]!.alive).toBe(true);
    expect(state.traces.some((t) => t.step === 'guard')).toBe(false);
  });
});

describe('batch A — Blackmailer (Mafia day-chat silence)', () => {
  /** Advance NIGHT → DAWN → DAY_DISCUSSION (a day-chat phase). */
  function toNextDayChat(state: GameState): GameState {
    let s = endPhase(state).state; // NIGHT -> DAWN
    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION
    return s;
  }

  it('silences the target\'s day chat the following day; others can still speak', () => {
    // 0 Blackmailer, 1 Godfather, 2 Mafioso, 3 Citizen (blackmailed), 4 Citizen.
    let s = makeGame(['BLACKMAILER', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'blackmail', 3);
    s = resolveNightPhase(s).state; // resolve NIGHT (sets silence + notice)

    expect(s.seats[3]!.silencedForNight).toBe(s.nightNumber);
    const blackmail = s.traces.find((t) => t.step === 'blackmail');
    expect(blackmail).toMatchObject({ step: 'blackmail', blackmailer: 0, target: 3 });

    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION

    // The blackmailed seat 3 is muted; seat 4 speaks normally.
    const muted = ev(s, { type: 'chat', seat: 3, channel: 'day', text: 'It was the mafioso!' });
    expect(dayChatFrom(muted.effects, 3)).toHaveLength(0);
    const free = ev(muted.state, { type: 'chat', seat: 4, channel: 'day', text: 'I agree.' });
    expect(dayChatFrom(free.effects, 4)).toHaveLength(1);
  });

  it('the silence expires by the next day cycle', () => {
    let s = makeGame(['BLACKMAILER', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'blackmail', 3);
    s = resolveNightPhase(s).state;
    // Day 1 (silenced): DAWN -> DAY_DISCUSSION -> DAY_VOTING -> (no lynch) NIGHT2.
    s = toNextDayChat(s); // DAY_DISCUSSION (silenced)
    s = endPhase(s).state; // DAY_DISCUSSION -> DAY_VOTING
    s = endPhase(s).state; // DAY_VOTING -> NIGHT 2 (no lynch)
    // Resolve NIGHT 2 with no new blackmail.
    s = resolveNightPhase(s).state;
    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION (day 2)

    // Seat 3 can speak again.
    const r = ev(s, { type: 'chat', seat: 3, channel: 'day', text: 'I can talk now.' });
    expect(dayChatFrom(r.effects, 3)).toHaveLength(1);
  });

  it('delivers a private blackmailed notice only to the target', () => {
    let s = makeGame(['BLACKMAILER', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'blackmail', 3);
    const { effects } = resolveNightPhase(s);
    const notice = privateResult(effects, 3, 'blackmailed');
    expect(notice).toBeDefined();
    expect(notice!.to).toEqual([3]);
    // No other seat receives a blackmailed notice.
    const all = effects.filter((e) => (e.msg as { kind?: string }).kind === 'blackmailed');
    expect(all).toHaveLength(1);
  });
});

describe('batch A — Veteran (Town alert)', () => {
  it('on alert: kills every visitor, survives the attack, and is roleblock-immune', () => {
    // 0 Veteran, 1 Godfather, 2 Mafioso (visits to kill), 3 Escort (visits to block),
    // 4 Sheriff (visits to investigate), 5..7 Citizen so the game continues.
    let s = makeGame([
      'VETERAN',
      'GODFATHER',
      'MAFIOSO',
      'ESCORT',
      'SHERIFF',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s = night(s, 0, 'alert', null); // veteran alerts
    s = night(s, 1, 'mafia_control', 0); // mafia targets the veteran
    s = night(s, 2, 'kill_mafia', 0); // mafioso performs the kill (a visit)
    s = night(s, 3, 'roleblock', 0); // escort tries to block the veteran (a visit)
    s = night(s, 4, 'investigate_sheriff', 0); // sheriff visits the veteran
    const { state } = resolveNightPhase(s);

    expect(state.seats[0]!.alive).toBe(true); // veteran survives (night-immune)
    expect(state.seats[2]!.alive).toBe(false); // mafioso visitor killed
    expect(state.seats[3]!.alive).toBe(false); // escort visitor killed
    expect(state.seats[4]!.alive).toBe(false); // sheriff visitor killed
    // The escort's roleblock failed (veteran roleblock-immune while alerting).
    const rb = state.traces.find((t) => t.step === 'roleblock' && t.target === 0);
    expect(rb).toMatchObject({ outcome: 'immune' });
    // The alert trace lists all visitors.
    const alert = state.traces.find((t) => t.step === 'alert');
    expect(alert).toMatchObject({ step: 'alert', veteran: 0 });
    if (alert && alert.step === 'alert') {
      expect(alert.visitors.slice().sort((a, b) => a - b)).toEqual([2, 3, 4]);
    }
    // One alert consumed (3 → 2).
    expect(state.seats[0]!.usesRemaining).toBe(2);
  });

  it('a night-immune visitor (Godfather performing the kill) survives the alert', () => {
    // 0 Veteran, 1 Godfather (performs the kill himself — night-immune), 2..6 Citizen.
    let s = makeGame([
      'VETERAN',
      'GODFATHER',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s = night(s, 0, 'alert', null);
    s = night(s, 1, 'kill_mafia', 0); // GF visits the veteran (night-immune)
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true); // veteran survives
    expect(state.seats[1]!.alive).toBe(true); // night-immune GF survives the alert
    const alert = state.traces.find((t) => t.step === 'alert');
    expect(alert).toMatchObject({ step: 'alert', veteran: 0, visitors: [1] });
  });

  it('does nothing when NOT alerting: a visitor lives and the veteran can be killed', () => {
    // 0 Veteran (no alert), 1 Godfather, 2 Mafioso, 3 Doctor (visits), 4..6 Citizen.
    let s = makeGame([
      'VETERAN',
      'GODFATHER',
      'MAFIOSO',
      'DOCTOR',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    // Veteran does NOT alert. Doctor visits the veteran (heals).
    s = night(s, 3, 'protect', 0);
    s = night(s, 1, 'mafia_control', 4);
    s = night(s, 2, 'kill_mafia', 4);
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.alive).toBe(true); // doctor visitor unharmed
    expect(state.traces.some((t) => t.step === 'alert')).toBe(false);
    expect(state.seats[0]!.usesRemaining).toBe(3); // no alert consumed
  });

  it('a jailed Veteran cannot alert (no alert fires, no use consumed)', () => {
    // 0 Jailor, 1 Veteran, 2 Mafioso, 3 Godfather, 4..6 Citizen.
    let s = makeGame([
      'JAILOR',
      'VETERAN',
      'MAFIOSO',
      'GODFATHER',
      'CITIZEN',
      'CITIZEN',
      'CITIZEN',
    ]);
    s = toFirstNight(s);
    s.jailTarget = 1; // jail the veteran (unit-isolation, mirrors night.test.ts)
    s = night(s, 1, 'alert', null); // veteran tries to alert from the cell
    s = night(s, 2, 'kill_mafia', 1); // mafia attacks the jailed veteran (unreachable)
    s = night(s, 3, 'mafia_control', 1);
    const { state } = resolveNightPhase(s);
    expect(state.traces.some((t) => t.step === 'alert')).toBe(false);
    expect(state.seats[1]!.usesRemaining).toBe(3); // jailed ⇒ no alert burned
    expect(state.seats[1]!.alive).toBe(true); // jail shields the prisoner
  });
});
