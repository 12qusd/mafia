import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, ev } from './harness.js';
import { yourRoleEffect } from '../src/roleinfo.js';
import type { Effect } from '@nocturne/shared';

/**
 * Triad faction golden cases (mirror of the Mafia kill/chat/succession suite).
 * The Triad is a second informed evil killing faction structurally identical to
 * the Mafia: Dragon Head orders, Enforcer performs, the kill is a BASIC attack,
 * the 'triad' chat reaches only living triad seats, and succession promotes a
 * survivor to Enforcer. The §5 entitlement invariant must hold throughout.
 */

/** Collect chat_message effects on a given channel. */
function chatOn(effects: Effect[], channel: string): Effect[] {
  return effects.filter(
    (e) => (e.msg as { type?: string }).type === 'chat_message' &&
      (e.msg as { channel?: string }).channel === channel,
  );
}

describe('Triad kill (basic attack; Dragon Head orders, Enforcer performs)', () => {
  it('the Enforcer kill lands on a town citizen (basic attack)', () => {
    // 0 Dragon Head, 1 Enforcer, 2 Citizen, 3 Sheriff, 4 Doctor
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'CITIZEN', 'SHERIFF', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 0, 'triad_control', 2);
    s = night(s, 1, 'kill_triad', 2);
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.alive).toBe(false);
    const kt = state.traces.find((t) => t.step === 'kill' && t.target === 2);
    expect(kt).toMatchObject({ step: 'kill', source: 'triad', outcome: 'died' });
  });

  it('a Doctor heal stops the Triad kill (basic attack)', () => {
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 0, 'triad_control', 2);
    s = night(s, 1, 'kill_triad', 2);
    s = night(s, 3, 'protect', 2); // doctor heals the victim
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.alive).toBe(true);
    const kt = state.traces.find((t) => t.step === 'kill' && t.target === 2);
    expect(kt).toMatchObject({ source: 'triad', outcome: 'healed' });
  });

  it('the Dragon Head is night-immune (survives a Vigilante shot)', () => {
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'VIGILANTE', 'CITIZEN']);
    s = toFirstNight(s);
    s.nightNumber = 2; // allow the vigilante to shoot (not N1)
    s = night(s, 2, 'kill_vigilante', 0); // vig shoots the Dragon Head
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true);
    const kt = state.traces.find((t) => t.step === 'kill' && t.target === 0);
    expect(kt).toMatchObject({ outcome: 'immune' });
  });

  it('the Dragon Head is roleblock-immune (an Escort block on it fails)', () => {
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'ESCORT', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 2, 'roleblock', 0); // escort → dragon head (immune)
    const { state } = resolveNightPhase(s);
    const immune = state.traces.find(
      (t) => t.step === 'roleblock' && t.target === 0 && t.outcome === 'immune',
    );
    expect(immune).toBeTruthy();
  });

  it('a Vanguard (triad roleblocker) cancels a Town Doctor heal', () => {
    // Vanguard blocks the Doctor → the Doctor cannot heal → the Enforcer kill lands.
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'VANGUARD', 'DOCTOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'triad_control', 4);
    s = night(s, 1, 'kill_triad', 4); // enforcer kills the citizen
    s = night(s, 3, 'protect', 4); // doctor tries to heal the citizen
    s = night(s, 2, 'roleblock', 3); // vanguard blocks the doctor
    const { state } = resolveNightPhase(s);
    const blocked = state.traces.find(
      (t) => t.step === 'roleblock' && t.target === 3 && t.outcome === 'blocked',
    );
    expect(blocked).toBeTruthy();
    // The heal never happened, so the citizen dies.
    expect(state.seats[4]!.alive).toBe(false);
  });

  it('Sheriff reads the Enforcer suspicious and the Dragon Head clean', () => {
    let s = makeGame(['SHERIFF', 'DRAGON_HEAD', 'ENFORCER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'investigate_sheriff', 2); // sheriff → enforcer
    const r = resolveNightPhase(s);
    const enforcerRead = r.state.traces.find(
      (t) => t.step === 'investigate' && t.kind === 'sheriff' && t.target === 2,
    );
    expect(enforcerRead).toMatchObject({ result: 'suspicious' });

    // Fresh game for the Dragon Head read.
    let s2 = makeGame(['SHERIFF', 'DRAGON_HEAD', 'ENFORCER', 'CITIZEN']);
    s2 = toFirstNight(s2);
    s2 = night(s2, 0, 'investigate_sheriff', 1); // sheriff → dragon head
    const r2 = resolveNightPhase(s2);
    const dhRead = r2.state.traces.find(
      (t) => t.step === 'investigate' && t.kind === 'sheriff' && t.target === 1,
    );
    expect(dhRead).toMatchObject({ result: 'not_suspicious' });
  });
});

describe('Triad succession (mirror of mafia succession)', () => {
  it('promotes the senior survivor to Enforcer when Dragon Head + Enforcer die', () => {
    // 0 Jailor, 1 Dragon Head, 2 Enforcer, 3 Vanguard, 4 Vigilante, 5 Citizen.
    // The Dragon Head is night-immune, so the Jailor execution (which pierces
    // immunity) removes it; the Vigilante guns down the Enforcer the same night.
    let s = makeGame(['JAILOR', 'DRAGON_HEAD', 'ENFORCER', 'VANGUARD', 'VIGILANTE', 'CITIZEN']);
    s = toFirstNight(s);
    s.nightNumber = 2; // vigilante may shoot
    s.jailTarget = 1; // the Dragon Head is jailed
    s = night(s, 0, 'kill_jailor', 1); // jailor executes the Dragon Head
    s = night(s, 4, 'kill_vigilante', 2); // vigilante shoots the Enforcer
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false); // Dragon Head dead
    expect(state.seats[2]!.alive).toBe(false); // Enforcer dead
    // The Vanguard (senior surviving Triad) is promoted to Enforcer.
    expect(state.seats[3]!.role).toBe('ENFORCER');
    expect(state.seats[3]!.faction).toBe('TRIAD');
    const promo = state.traces.find(
      (t) => t.step === 'promotion' && t.kind === 'triad_succession',
    );
    expect(promo).toMatchObject({ kind: 'triad_succession', seat: 3, newRole: 'ENFORCER' });
  });
});

describe('Triad chat (§5 entitlement: only living triad seats)', () => {
  it("a triad seat's night chat reaches ONLY living triad seats", () => {
    // 0 Dragon Head, 1 Enforcer (triad); 2 Godfather (mafia); 3 Citizen (town).
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'GODFATHER', 'CITIZEN']);
    s = toFirstNight(s);
    const r = ev(s, { type: 'chat', seat: 0, channel: 'triad', text: 'tonight: 3' });
    const triadChat = chatOn(r.effects, 'triad');
    expect(triadChat).toHaveLength(1);
    // Addressed to exactly the living triad seats {0,1} — never the mafia (2) or town (3).
    expect(triadChat[0]!.to).toEqual([0, 1]);
  });

  it('a NON-triad seat cannot write to the triad channel (no frame emitted)', () => {
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'GODFATHER', 'CITIZEN']);
    s = toFirstNight(s);
    // The Mafia Godfather tries to speak in triad chat → dropped.
    const mafiaTry = ev(s, { type: 'chat', seat: 2, channel: 'triad', text: 'spy on you' });
    expect(chatOn(mafiaTry.effects, 'triad')).toHaveLength(0);
    // A Town citizen likewise.
    const townTry = ev(s, { type: 'chat', seat: 3, channel: 'triad', text: 'hello?' });
    expect(chatOn(townTry.effects, 'triad')).toHaveLength(0);
  });

  it('your_role delivers the triad roster ONLY to triad seats, mafia roster ONLY to mafia', () => {
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    for (const seat of s.seats) {
      const eff = yourRoleEffect(s, seat);
      expect(eff.to).toEqual([seat.seat]); // addressed to the owning seat alone
      const msg = eff.msg as { mates?: number[] };
      if (seat.faction === 'TRIAD') {
        // Mates are exactly the OTHER triad seats — never any mafia/town seat.
        for (const m of msg.mates ?? []) expect(s.seats[m]!.faction).toBe('TRIAD');
        expect(msg.mates).not.toContain(seat.seat);
      } else if (seat.faction === 'MAFIA') {
        for (const m of msg.mates ?? []) expect(s.seats[m]!.faction).toBe('MAFIA');
      } else {
        expect(msg.mates).toBeUndefined();
      }
    }
  });
});
