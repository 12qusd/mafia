import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, step, ev, endPhase, resolveNightPhase } from './harness.js';
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

/** Find the public death_announce effect for `seat`. */
function deathAnnounce(effects: Effect[], seat: number) {
  return effects.find(
    (e) =>
      e.to === 'public' &&
      (e.msg as { type?: string }).type === 'death_announce' &&
      (e.msg as { seat?: number }).seat === seat,
  );
}

describe('batch B — Tracker (Town visit-trail)', () => {
  it('learns who the watched target visited, addressed only to the tracker', () => {
    // 0 Tracker (tracks 2), 1 Godfather, 2 Sheriff (visits seat 3), 3..5 Citizen.
    let s = makeGame(['TRACKER', 'GODFATHER', 'SHERIFF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_track', 2); // track the sheriff
    s = night(s, 2, 'investigate_sheriff', 3); // sheriff visits seat 3
    const { state, effects } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'investigate' && t.kind === 'tracker');
    expect(trace).toMatchObject({ step: 'investigate', kind: 'tracker', investigator: 0, target: 2, visited: [3] });

    const eff = privateResult(effects, 0, 'tracker_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]); // §5: only the tracker
    expect(eff!.msg).toMatchObject({ kind: 'tracker_result', target: 2, visited: [3] });
  });

  it('reports an empty trail for a target who did not visit anyone', () => {
    // 0 Tracker (tracks 2), 1 Godfather, 2 Citizen (no action), 3..5 Citizen.
    let s = makeGame(['TRACKER', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_track', 2);
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'tracker_result');
    expect(eff!.msg).toMatchObject({ visited: [] });
  });

  it('sees the mafia kill performer\'s victim (the kill_mafia actor visits)', () => {
    // 0 Tracker (tracks 2 the mafioso), 1 Godfather (control), 2 Mafioso (kills 3), 3..6 Citizen.
    let s = makeGame(['TRACKER', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_track', 2);
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'tracker_result');
    expect(eff!.msg).toMatchObject({ visited: [3] });
  });

  it('result never reaches a seat other than the tracker', () => {
    let s = makeGame(['TRACKER', 'GODFATHER', 'SHERIFF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_track', 2);
    s = night(s, 2, 'investigate_sheriff', 3);
    const { effects } = resolveNightPhase(s);
    for (const e of effects) {
      if ((e.msg as { kind?: string }).kind === 'tracker_result') expect(e.to).toEqual([0]);
    }
  });
});

describe('batch B — Spy (Town mafia-watch)', () => {
  it('learns the set of seats the mafia visited, not their identities', () => {
    // 0 Spy, 1 Godfather (control), 2 Mafioso (kills 4), 3 Framer (frames 5), 4..6 Citizen.
    let s = makeGame(['SPY', 'GODFATHER', 'MAFIOSO', 'FRAMER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'spy', null);
    s = night(s, 1, 'mafia_control', 4);
    s = night(s, 2, 'kill_mafia', 4);
    s = night(s, 3, 'frame', 5);
    const { state, effects } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'investigate' && t.kind === 'spy');
    expect(trace).toMatchObject({ step: 'investigate', kind: 'spy', investigator: 0 });
    const eff = privateResult(effects, 0, 'spy_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]);
    // Mafioso visited 4, Framer visited 5; Godfather control does NOT visit.
    expect((eff!.msg as { seats?: number[] }).seats!.slice().sort((a, b) => a - b)).toEqual([4, 5]);
    // The result carries NO role strings — only seat ids.
    const body = JSON.stringify(eff!.msg);
    expect(body).not.toContain('MAFIOSO');
    expect(body).not.toContain('FRAMER');
  });

  it('reports an empty set when the mafia stayed in (control only)', () => {
    // 0 Spy, 1 Godfather (control only, no performer), 2..5 Citizen.
    let s = makeGame(['SPY', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'spy', null);
    s = night(s, 1, 'mafia_control', 2); // control does not visit; no performer
    const { effects } = resolveNightPhase(s);
    const eff = privateResult(effects, 0, 'spy_result');
    expect((eff!.msg as { seats?: number[] }).seats).toEqual([]);
  });
});

describe('batch B — Amnesiac (Neutral benign conversion)', () => {
  it('remembers a dead seat\'s role and becomes it (role + faction change)', () => {
    // 0 Amnesiac, 1 Godfather, 2 Mafioso, 3 Doctor (will die N1), 4..6 Citizen.
    let s = makeGame(['AMNESIAC', 'GODFATHER', 'MAFIOSO', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // N1: mafia kills the doctor.
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    // N2: the amnesiac remembers the dead doctor.
    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION
    s = endPhase(s).state; // DAY_DISCUSSION -> DAY_VOTING
    s = endPhase(s).state; // DAY_VOTING -> NIGHT 2 (no lynch)
    s = night(s, 0, 'remember', 3);
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[0]!.role).toBe('DOCTOR');
    expect(state.seats[0]!.faction).toBe('TOWN');
    const trace = state.traces.find((t) => t.step === 'promotion' && t.kind === 'amnesiac_remember');
    expect(trace).toMatchObject({ kind: 'amnesiac_remember', seat: 0, newRole: 'DOCTOR' });
    const eff = privateResult(effects, 0, 'remember_result');
    expect(eff).toBeDefined();
    expect(eff!.to).toEqual([0]);
    expect(eff!.msg).toMatchObject({ kind: 'remember_result', target: 3, role: 'DOCTOR' });
  });

  it('becoming a Mafia role flips faction and joins the mafia roster', () => {
    // 0 Amnesiac, 1 Godfather, 2 Mafioso, 3 Consort (will die), 4..6 Citizen.
    let s = makeGame(['AMNESIAC', 'GODFATHER', 'MAFIOSO', 'CONSORT', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // Kill the consort via vigilante? Simpler: lynch-independent — use a vigilante.
    // Replace seat 4 with a vigilante to do the killing.
    s.seats[4]!.role = 'VIGILANTE';
    s.seats[4]!.usesRemaining = 2;
    s.nightNumber = 2; // allow the vig to shoot
    s = night(s, 4, 'kill_vigilante', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = night(s, 0, 'remember', 3); // remember the dead consort
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.role).toBe('CONSORT');
    expect(state.seats[0]!.faction).toBe('MAFIA');
    expect(state.mafiaSeats).toContain(0);
  });

  it('cannot remember a unique role still held by a living seat (Godfather)', () => {
    // 0 Amnesiac, 1 Godfather (alive), 2 Mafioso, 3 Godfather... not possible (unique).
    // Instead: a dead seat is a MAYOR but a living MAYOR exists → cannot remember.
    let s = makeGame(['AMNESIAC', 'MAYOR', 'GODFATHER', 'MAYOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s.seats[4]!.role = 'VIGILANTE';
    s.seats[4]!.usesRemaining = 2;
    s.nightNumber = 2;
    s = night(s, 4, 'kill_vigilante', 3); // kill the (second) Mayor
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = night(s, 0, 'remember', 3); // try to remember the dead Mayor — a living Mayor (seat 1) exists
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.role).toBe('AMNESIAC'); // remained an Amnesiac
    expect(state.traces.some((t) => t.step === 'promotion' && t.kind === 'amnesiac_remember')).toBe(false);
  });

  it('cannot remember a Jester / Executioner / another Amnesiac', () => {
    // Dead seat is a JESTER → forbidden.
    let s = makeGame(['AMNESIAC', 'GODFATHER', 'MAFIOSO', 'JESTER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s.seats[4]!.role = 'VIGILANTE';
    s.seats[4]!.usesRemaining = 2;
    s.nightNumber = 2;
    s = night(s, 4, 'kill_vigilante', 3);
    s = resolveNightPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = night(s, 0, 'remember', 3);
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.role).toBe('AMNESIAC');
  });
});

describe('batch B — Medium (Town séance)', () => {
  /** Collect dead-channel chat effects addressed to a set including `seat`. */
  function deadChatTo(effects: Effect[], seat: number) {
    return effects.filter(
      (e) =>
        (e.msg as { type?: string }).type === 'chat_message' &&
        (e.msg as { channel?: string }).channel === 'dead' &&
        Array.isArray(e.to) &&
        (e.to as number[]).includes(seat),
    );
  }

  it('a living medium with an open séance can speak with the dead at night', () => {
    // 0 Medium, 1 Godfather, 2 Mafioso, 3 Citizen (will die), 4..6 Citizen.
    let s = makeGame(['MEDIUM', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // N1: kill seat 3 so there is a dead audience.
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    // Day 1: the medium opens a séance for the coming night.
    s = endPhase(s).state; // DAWN -> DAY_DISCUSSION
    const ack = ev(s, { type: 'day_ability', seat: 0, ability: 'seance', target: undefined });
    s = ack.state;
    expect(s.seanceMedium).toBe(0);

    // Advance to NIGHT 2.
    s = endPhase(s).state; // DAY_DISCUSSION -> DAY_VOTING
    s = endPhase(s).state; // DAY_VOTING -> NIGHT 2 (no lynch)
    expect(s.phase).toBe('NIGHT');
    expect(s.seanceMedium).toBe(0); // séance carried into the night

    // The living medium speaks in the dead channel; the dead seat (3) + medium hear it.
    const r = ev(s, { type: 'chat', seat: 0, channel: 'dead', text: 'Who killed you?' });
    const chats = deadChatTo(r.effects, 3);
    expect(chats.length).toBe(1);
    // The audience includes the dead seat 3 AND the medium 0, and NO living non-medium.
    const audience = chats[0]!.to as number[];
    expect(audience).toContain(3);
    expect(audience).toContain(0);
    expect(audience).not.toContain(1); // a living non-medium is never in the séance
    expect(audience).not.toContain(2);
  });

  it('a living non-medium cannot speak in the dead channel even during a séance', () => {
    let s = makeGame(['MEDIUM', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    s = endPhase(s).state;
    s = step(s, { type: 'day_ability', seat: 0, ability: 'seance', target: undefined });
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 2
    // A living non-medium (seat 1) tries to speak in dead chat — dropped.
    const r = ev(s, { type: 'chat', seat: 1, channel: 'dead', text: 'let me in' });
    const chats = r.effects.filter(
      (e) => (e.msg as { type?: string }).type === 'chat_message' && (e.msg as { channel?: string }).channel === 'dead',
    );
    expect(chats).toHaveLength(0);
  });

  it('the séance consumes one use and closes after the night', () => {
    let s = makeGame(['MEDIUM', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    s = endPhase(s).state;
    s = step(s, { type: 'day_ability', seat: 0, ability: 'seance', target: undefined });
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 2
    expect(s.seats[0]!.usesRemaining).toBe(1);
    s = resolveNightPhase(s).state; // resolve NIGHT 2
    expect(s.seanceMedium).toBeNull(); // closed
    expect(s.seats[0]!.usesRemaining).toBe(0); // one séance consumed
  });
});

describe('batch B — Disguiser (Mafia appearance overlay)', () => {
  it('takes a dead seat\'s role appearance for investigations and death reveal', () => {
    // 0 Disguiser, 1 Godfather, 2 Mafioso, 3 Doctor (killed N1), 4 Sheriff, 5..7 Citizen.
    let s = makeGame(['DISGUISER', 'GODFATHER', 'MAFIOSO', 'DOCTOR', 'SHERIFF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // N1: mafia kills the doctor (seat 3).
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    // N2: disguiser takes the dead doctor's appearance; sheriff checks the disguiser.
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 2
    s = night(s, 0, 'disguise', 3); // borrow the dead doctor (not suspicious)
    s = night(s, 4, 'investigate_sheriff', 0); // sheriff checks the disguiser
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[0]!.apparentRole).toBe('DOCTOR');
    // The sheriff reads the disguise (Doctor = not suspicious) despite the true
    // role being a suspicious Disguiser.
    const sr = privateResult(effects, 4, 'sheriff_result');
    expect(sr!.msg).toMatchObject({ result: 'not_suspicious' });
    // True role/faction are unchanged.
    expect(state.seats[0]!.role).toBe('DISGUISER');
    expect(state.seats[0]!.faction).toBe('MAFIA');
  });

  it('the disguiser\'s death reveal shows the disguised role', () => {
    // 0 Disguiser, 1 Godfather, 2 Citizen (killed N1 by vig), 3 Vigilante, 4..6 Citizen.
    let s = makeGame(['DISGUISER', 'GODFATHER', 'CITIZEN', 'VIGILANTE', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s.nightNumber = 2;
    s = night(s, 3, 'kill_vigilante', 2); // vig kills seat 2 (a Citizen)
    s = resolveNightPhase(s).state;
    expect(s.seats[2]!.alive).toBe(false);

    // N2: disguiser borrows the dead citizen's face.
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 3
    s = night(s, 0, 'disguise', 2);
    s = resolveNightPhase(s).state;
    expect(s.seats[0]!.apparentRole).toBe('CITIZEN');

    // N3: the vigilante shoots the disguiser; the death reveal shows CITIZEN.
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 4
    s = night(s, 3, 'kill_vigilante', 0);
    const { state, effects } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(false);
    const da = deathAnnounce(effects, 0);
    expect((da!.msg as { role?: string }).role).toBe('CITIZEN'); // the borrowed name
  });

  it('ignores a living disguise target (no appearance to borrow)', () => {
    let s = makeGame(['DISGUISER', 'GODFATHER', 'MAFIOSO', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'disguise', 3); // seat 3 is alive
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.apparentRole).toBeNull();
    expect(state.traces.some((t) => t.step === 'disguise')).toBe(false);
  });
});

describe('batch B — Arsonist (Neutral killing, douse + ignite)', () => {
  it('douses targets without killing, then ignites to kill all doused at once', () => {
    // 0 Arsonist, 1 Godfather, 2 Mafioso, 3..6 Citizen (douse 3 & 4, then ignite).
    let s = makeGame(['ARSONIST', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // N1: douse seats 3 and 4 across two nights — here douse seat 3.
    s = night(s, 0, 'douse', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(true); // doused, not killed
    expect(s.seats[3]!.doused).toBe(true);

    // N2: douse seat 4.
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 2
    s = night(s, 0, 'douse', 4);
    s = resolveNightPhase(s).state;
    expect(s.seats[4]!.doused).toBe(true);

    // N3: ignite — burns both doused seats.
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 3
    s = night(s, 0, 'ignite', null);
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.alive).toBe(false);
    expect(state.seats[4]!.alive).toBe(false);
    expect(state.seats[3]!.deathCause).toBe('arsonist');
    const ignite = state.traces.find((t) => t.step === 'ignite');
    expect(ignite).toMatchObject({ step: 'ignite', arsonist: 0 });
    if (ignite && ignite.step === 'ignite') {
      expect(ignite.victims.slice().sort((a, b) => a - b)).toEqual([3, 4]);
    }
    // Doused flags cleared after the blaze.
    expect(state.seats[3]!.doused).toBe(false);
  });

  it('ignite pierces a doctor heal and a bodyguard (powerful attack)', () => {
    // 0 Arsonist, 1 Godfather, 2 Doctor (heals 4), 3 Bodyguard (guards 5), 4 & 5 Citizen (doused), 6 Citizen.
    let s = makeGame(['ARSONIST', 'GODFATHER', 'DOCTOR', 'BODYGUARD', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'douse', 4);
    s = resolveNightPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 2
    s = night(s, 0, 'douse', 5);
    s = resolveNightPhase(s).state;

    s = endPhase(s).state;
    s = endPhase(s).state;
    s = endPhase(s).state; // NIGHT 3
    s = night(s, 0, 'ignite', null);
    s = night(s, 2, 'protect', 4); // doctor tries to heal a doused seat
    s = night(s, 3, 'guard', 5); // bodyguard tries to guard a doused seat
    const { state } = resolveNightPhase(s);
    expect(state.seats[4]!.alive).toBe(false); // heal does not stop the fire
    expect(state.seats[5]!.alive).toBe(false); // bodyguard does not stop the fire
    expect(state.seats[3]!.alive).toBe(true); // bodyguard does NOT die (no basic attack to intercept)
  });

  it('the arsonist is night-immune (survives the mafia kill)', () => {
    let s = makeGame(['ARSONIST', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 0);
    s = night(s, 2, 'kill_mafia', 0); // mafia attacks the arsonist
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true);
  });

  it('a jailed doused victim survives the ignite (jail stops it)', () => {
    // 0 Jailor, 1 Arsonist, 2 Godfather, 3 Citizen (doused then jailed), 4..6 Citizen.
    let s = makeGame(['JAILOR', 'ARSONIST', 'GODFATHER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'douse', 3); // arsonist douses seat 3
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.doused).toBe(true);

    s = endPhase(s).state; // DAWN
    s = endPhase(s).state; // DAY_DISCUSSION
    s = endPhase(s).state; // DAY_VOTING
    s = endPhase(s).state; // NIGHT 2
    s.jailTarget = 3; // jail the doused citizen
    s = night(s, 1, 'ignite', null);
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.alive).toBe(true); // jail shields the prisoner from the fire
  });
});
