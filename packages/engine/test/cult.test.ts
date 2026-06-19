import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, toNextNight } from './harness.js';
import { yourRoleEffect } from '../src/roleinfo.js';

/**
 * Cult conversion-faction golden cases (Cult faction).
 *
 * The Cult wins by RECRUITMENT + parity, not by a faction kill. ONLY the (unique)
 * Cult Leader recruits — one convert per night, with a one-night cooldown — and a
 * successful recruit DRAWS a TOWN/benign target into the Cult (role + faction
 * change to CULTIST/CULT). Recruitment STOPS the moment the Leader dies. The
 * knowledge-isolated design means NO cult chat and NO roster — verified here via
 * your_role.
 */

describe('Cult recruit / conversion', () => {
  it('a recruit draws a Town citizen into the Cult (role + faction change)', () => {
    // 0 Cult Leader, 1 Citizen, 2 Sheriff
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.seats[1]!.role).toBe('CULTIST');
    expect(state.seats[1]!.faction).toBe('CULT');
    const rec = state.traces.find((t) => t.step === 'recruit');
    expect(rec).toMatchObject({ step: 'recruit', leader: 0, target: 1, recruited: true });
  });

  it('the recruited seat is told privately "recruited" and no one else is', () => {
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1);
    const { effects } = resolveNightPhase(s);
    const recruited = effects.filter(
      (e) =>
        (e.msg as { type?: string; kind?: string }).type === 'private_result' &&
        (e.msg as { kind?: string }).kind === 'recruited',
    );
    expect(recruited).toHaveLength(1);
    // Addressed to the recruited seat (1) ALONE — never to anyone else.
    expect(recruited[0]!.to).toEqual([1]);
  });

  it('a recruit FAILS against a night-immune target (Serial Killer)', () => {
    let s = makeGame(['CULT_LEADER', 'SERIAL_KILLER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1); // recruit the SK (night-immune + not convertible)
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.role).toBe('SERIAL_KILLER');
    expect(state.seats[1]!.faction).toBe('NEUTRAL_KILLING');
    const rec = state.traces.find((t) => t.step === 'recruit');
    expect(rec).toMatchObject({ recruited: false });
  });

  it('a recruit FAILS against a Mafia seat (only Town/benign are convertible)', () => {
    let s = makeGame(['CULT_LEADER', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1); // recruit the mafioso → not convertible
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.faction).toBe('MAFIA');
    const rec = state.traces.find((t) => t.step === 'recruit');
    expect(rec).toMatchObject({ recruited: false });
  });

  it('a NEUTRAL_BENIGN seat (Survivor) IS convertible', () => {
    let s = makeGame(['CULT_LEADER', 'SURVIVOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.faction).toBe('CULT');
    expect(state.seats[1]!.role).toBe('CULTIST');
  });

  it('a Cultist CANNOT recruit — only the Cult Leader can', () => {
    // 0 Cult Leader, 1 Cultist (already converted body), 2 Citizen, 3 Citizen.
    // The Cultist tries to recruit seat 3; nothing happens (only the Leader recruits).
    let s = makeGame(['CULT_LEADER', 'CULTIST', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'recruit', 3); // the Cultist (no recruit ability) targets seat 3
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.faction).toBe('TOWN'); // not converted by a Cultist
    // No recruit trace at all (the Cultist's intent is not a valid recruit).
    const rec = state.traces.find((t) => t.step === 'recruit');
    expect(rec).toBeUndefined();
  });

  it('the Leader cannot recruit two nights running (one-night cooldown)', () => {
    // 0 Cult Leader, 1..4 Citizen. Recruit on night 1, attempt again night 2.
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1); // night 1 → succeeds
    s = toNextNight(s); // resolve N1, advance to N2
    expect(s.seats[1]!.faction).toBe('CULT'); // night-1 recruit landed
    s = night(s, 0, 'recruit', 2); // night 2 → cooldown, fails
    const r2 = resolveNightPhase(s);
    expect(r2.state.seats[2]!.faction).toBe('TOWN'); // NOT converted (cooldown)
    // `traces` accumulates across the match — take the MOST RECENT recruit trace.
    const rec2 = [...r2.state.traces].reverse().find((t) => t.step === 'recruit');
    expect(rec2).toMatchObject({ target: 2, recruited: false });
  });

  it('the Leader CAN recruit again the night after the cooldown rest', () => {
    // Recruit N1, rest N2 (cooldown), recruit again N3.
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1); // N1 recruit
    s = toNextNight(s); // → N2
    s = night(s, 0, 'recruit', 2); // N2 attempt (cooldown → fails)
    s = toNextNight(s); // → N3
    expect(s.seats[2]!.faction).toBe('TOWN'); // N2 was blocked by cooldown
    s = night(s, 0, 'recruit', 3); // N3 recruit (cooldown clear)
    const r3 = resolveNightPhase(s);
    expect(r3.state.seats[3]!.faction).toBe('CULT'); // N3 recruit landed
  });

  it('a jailed recruit target is unreachable — no conversion', () => {
    // 0 Jailor, 1 Cult Leader, 2 Citizen. Jailor jails the citizen the Leader recruits.
    let s = makeGame(['JAILOR', 'CULT_LEADER', 'CITIZEN']);
    s = toFirstNight(s);
    s.jailTarget = 2;
    s = night(s, 1, 'recruit', 2);
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.faction).toBe('TOWN');
    const rec = state.traces.find((t) => t.step === 'recruit');
    expect(rec).toMatchObject({ recruited: false });
  });

  it('a recruit grows the faction toward a parity win (does not end early)', () => {
    // 0 Cult Leader, 1..3 Citizen, 4 Sheriff. After one recruit: 2 cult vs 3 town —
    // not yet parity, so the game continues.
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1);
    const { state } = resolveNightPhase(s);
    const cult = state.seats.filter((x) => x.alive && x.faction === 'CULT').length;
    expect(cult).toBe(2);
    expect(state.gameOver).toBeNull(); // 2 cult vs 3 town — game continues
  });
});

describe('Cult §5 knowledge-isolation (NO chat, NO roster)', () => {
  it('your_role delivers NO mates to a Cult seat (Leader or Cultist)', () => {
    const s = makeGame(['CULT_LEADER', 'CULTIST', 'CITIZEN', 'SHERIFF']);
    for (const seat of s.seats) {
      const eff = yourRoleEffect(s, seat);
      expect(eff.to).toEqual([seat.seat]);
      const msg = eff.msg as { mates?: number[] };
      // Cult members (like Town) get NO faction roster — each walks alone.
      expect(msg.mates).toBeUndefined();
    }
  });
});
