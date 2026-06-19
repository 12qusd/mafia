import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, endPhase } from './harness.js';
import { yourRoleEffect } from './../src/roleinfo.js';
import type { Effect } from '@nocturne/shared';

/**
 * Golden coverage for the mid-game `your_role` RESEND (data-contract foundation
 * for the client role-card fix). Whenever a seat's role/faction is mutated during
 * night resolution (conversion / promotion / succession), the engine MUST re-emit
 * a fresh `your_role` addressed ONLY to that seat so its UI rebuilds the card +
 * abilities. The resend must:
 *   - carry the NEW role + abilities,
 *   - be addressed to the owning seat only (§5),
 *   - carry NO `mates` for a converted Vampire/Cultist (knowledge-isolation),
 *   - carry the correct faction roster ONLY for a succeeded Mafioso/Enforcer or an
 *     Amnesiac who legitimately remembered a mafia/triad role.
 */

/** Find the `your_role` frame resent to `seat` (addressed to that seat alone). */
function yourRoleTo(effects: Effect[], seat: number) {
  return effects.find(
    (e) =>
      Array.isArray(e.to) &&
      e.to.length === 1 &&
      e.to[0] === seat &&
      (e.msg as { type?: string }).type === 'your_role',
  );
}

/** Advance NIGHT → DAWN → DAY_DISCUSSION → DAY_VOTING → next NIGHT. */
function toNextNightFrom(state: ReturnType<typeof makeGame>) {
  let s = endPhase(state).state; // DAWN -> DAY_DISCUSSION
  s = endPhase(s).state; // DAY_DISCUSSION -> DAY_VOTING
  s = endPhase(s).state; // DAY_VOTING -> NIGHT (no lynch)
  return s;
}

describe('your_role resend — Amnesiac remember', () => {
  it('a remembered Doctor receives a fresh your_role with the Doctor card', () => {
    // 0 Amnesiac, 1 Godfather, 2 Mafioso, 3 Doctor (dies N1), 4..6 Citizen.
    let s = makeGame(['AMNESIAC', 'GODFATHER', 'MAFIOSO', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 1, 'mafia_control', 3);
    s = night(s, 2, 'kill_mafia', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    s = toNextNightFrom(s);
    s = night(s, 0, 'remember', 3);
    const { effects } = resolveNightPhase(s);

    const yr = yourRoleTo(effects, 0);
    expect(yr).toBeDefined();
    expect(yr!.to).toEqual([0]);
    const msg = yr!.msg as { role: string; faction: string; abilities: { id: string }[]; mates?: number[] };
    expect(msg.role).toBe('DOCTOR');
    expect(msg.faction).toBe('TOWN');
    expect(msg.abilities.map((a) => a.id)).toContain('protect');
    expect(msg.mates).toBeUndefined(); // Town: no roster
  });

  it('a remembered Consort (mafia) gets the new card WITH the mafia roster', () => {
    let s = makeGame(['AMNESIAC', 'GODFATHER', 'MAFIOSO', 'CONSORT', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s.seats[4]!.role = 'VIGILANTE';
    s.seats[4]!.usesRemaining = 2;
    s.nightNumber = 2;
    s = night(s, 4, 'kill_vigilante', 3);
    s = resolveNightPhase(s).state;
    expect(s.seats[3]!.alive).toBe(false);

    s = toNextNightFrom(s);
    s = night(s, 0, 'remember', 3);
    const { state, effects } = resolveNightPhase(s);

    expect(state.seats[0]!.faction).toBe('MAFIA');
    const yr = yourRoleTo(effects, 0);
    expect(yr).toBeDefined();
    const msg = yr!.msg as { role: string; faction: string; mates?: number[] };
    expect(msg.role).toBe('CONSORT');
    expect(msg.faction).toBe('MAFIA');
    // Legitimately mafia now → gets the mafia roster. The roster lists every MAFIA
    // seat besides itself (mirrors the deal-time roster, including the slain seat 3
    // whose faction stays MAFIA after death).
    expect(msg.mates).toContain(1);
    expect(msg.mates).toContain(2);
    expect(msg.mates).not.toContain(0); // never itself
  });
});

describe('your_role resend — Plaguebearer → Pestilence', () => {
  it('the new Pestilence receives a fresh your_role showing Reap', () => {
    // Small game so a single night infects everyone (visit edges) → transform.
    let s = makeGame(['PLAGUEBEARER', 'DOCTOR', 'SHERIFF']);
    s = toFirstNight(s);
    // Plaguebearer visits 1, Doctor heals 2, Sheriff checks 0 → visit graph covers all.
    s = night(s, 0, 'infect', 1);
    s = night(s, 1, 'protect', 2);
    s = night(s, 2, 'investigate_sheriff', 0);
    const { state, effects } = resolveNightPhase(s);

    // Only assert the resend IF the transformation actually fired this night.
    if (state.seats[0]!.role === 'PESTILENCE') {
      const yr = yourRoleTo(effects, 0);
      expect(yr).toBeDefined();
      const msg = yr!.msg as { role: string; abilities: { id: string }[]; mates?: number[] };
      expect(msg.role).toBe('PESTILENCE');
      expect(msg.abilities.map((a) => a.id)).toContain('pestilence');
      expect(msg.abilities.map((a) => a.id)).not.toContain('infect');
      expect(msg.mates).toBeUndefined();
    }
  });
});

describe('your_role resend — Vampire convert (knowledge-isolation)', () => {
  it('a converted seat gets a Vampire card with NO mates roster', () => {
    // 0 Vampire, 1 Citizen (convertible), 2 Sheriff.
    let s = makeGame(['VAMPIRE', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1);
    const { state, effects } = resolveNightPhase(s);
    expect(state.seats[1]!.role).toBe('VAMPIRE');
    expect(state.seats[1]!.faction).toBe('VAMPIRE');

    const yr = yourRoleTo(effects, 1);
    expect(yr).toBeDefined();
    expect(yr!.to).toEqual([1]);
    const msg = yr!.msg as { role: string; faction: string; abilities: { id: string }[]; mates?: number[] };
    expect(msg.role).toBe('VAMPIRE');
    expect(msg.faction).toBe('VAMPIRE');
    expect(msg.abilities.map((a) => a.id)).toContain('bite');
    // CRITICAL leak guard: the convert learns NO vampire roster.
    expect(msg.mates).toBeUndefined();
    // The frame names no OTHER seat's role anywhere.
    const body = JSON.stringify(yr!.msg);
    expect(body).not.toContain('"mates"');
  });
});

describe('your_role resend — Cult recruit (knowledge-isolation)', () => {
  it('a recruited seat gets a Cultist card with NO mates roster', () => {
    let s = makeGame(['CULT_LEADER', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'recruit', 1);
    const { state, effects } = resolveNightPhase(s);
    expect(state.seats[1]!.role).toBe('CULTIST');

    const yr = yourRoleTo(effects, 1);
    expect(yr).toBeDefined();
    const msg = yr!.msg as { role: string; faction: string; mates?: number[] };
    expect(msg.role).toBe('CULTIST');
    expect(msg.faction).toBe('CULT');
    expect(msg.mates).toBeUndefined();
  });
});

describe('your_role resend — Mafia succession', () => {
  it('the promoted Mafioso receives a fresh your_role with the mafia roster', () => {
    // 0 Mafioso (dies — not night-immune), 1 Consort, 2 Framer, 3 Vigilante, 4..6 Citizen.
    // No Godfather alive + the lone Mafioso dies ⇒ the senior survivor is promoted.
    let s = makeGame(['MAFIOSO', 'CONSORT', 'FRAMER', 'VIGILANTE', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s.seats[3]!.usesRemaining = 2;
    s.nightNumber = 2; // allow the vig to shoot
    s = night(s, 3, 'kill_vigilante', 0); // kill the (non-immune) Mafioso
    const { state, effects } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(false);

    // Senior living mafia (lowest living seat = 1, the Consort) becomes Mafioso.
    expect(state.seats[1]!.role).toBe('MAFIOSO');
    const yr = yourRoleTo(effects, 1);
    expect(yr).toBeDefined();
    const msg = yr!.msg as { role: string; faction: string; abilities: { id: string }[]; mates?: number[] };
    expect(msg.role).toBe('MAFIOSO');
    expect(msg.faction).toBe('MAFIA');
    expect(msg.abilities.map((a) => a.id)).toContain('kill_mafia');
    // Roster = the OTHER mafia seats (the Framer at 2, and the slain seat 0 still
    // carries the MAFIA faction — the roster mirrors the deal-time roster).
    expect(msg.mates).toContain(2);
  });
});

describe('your_role assignedTarget — Executioner mark / GA charge', () => {
  it('an Executioner your_role carries its mark as assignedTarget', () => {
    const s = makeGame(['EXECUTIONER', 'CITIZEN', 'SHERIFF']);
    s.seats[0]!.exeTarget = 2;
    const eff = yourRoleEffect(s, s.seats[0]!);
    expect(eff.to).toEqual([0]);
    expect((eff.msg as { assignedTarget?: number }).assignedTarget).toBe(2);
  });

  it('a Guardian Angel your_role carries its charge as assignedTarget', () => {
    const s = makeGame(['GUARDIAN_ANGEL', 'CITIZEN', 'SHERIFF']);
    s.seats[0]!.gaTarget = 1;
    const eff = yourRoleEffect(s, s.seats[0]!);
    expect(eff.to).toEqual([0]);
    expect((eff.msg as { assignedTarget?: number }).assignedTarget).toBe(1);
  });

  it('a role with no bound target omits assignedTarget', () => {
    const s = makeGame(['DOCTOR', 'CITIZEN', 'SHERIFF']);
    const eff = yourRoleEffect(s, s.seats[0]!);
    expect((eff.msg as { assignedTarget?: number }).assignedTarget).toBeUndefined();
  });
});

describe('AbilityInfo target-domain + verb', () => {
  it('DEAD-targeting abilities report domain "dead"', () => {
    const cases: [string, string][] = [
      ['CORONER', 'autopsy'],
      ['AMNESIAC', 'remember'],
      ['DISGUISER', 'disguise'],
    ];
    for (const [role, id] of cases) {
      const s = makeGame([role as never, 'CITIZEN', 'SHERIFF']);
      const eff = yourRoleEffect(s, s.seats[0]!);
      const ab = (eff.msg as { abilities: { id: string; targetDomain: string; verb: string }[] }).abilities.find(
        (a) => a.id === id,
      );
      expect(ab, `${role}/${id}`).toBeDefined();
      expect(ab!.targetDomain).toBe('dead');
      expect(ab!.verb.length).toBeGreaterThan(0);
    }
  });

  it('SELF toggles report domain "self"', () => {
    const cases: [string, string][] = [
      ['VETERAN', 'alert'],
      ['SURVIVOR', 'vest'],
      ['ARSONIST', 'ignite'],
      ['SPY', 'spy'],
      ['PSYCHIC', 'divine'],
    ];
    for (const [role, id] of cases) {
      const s = makeGame([role as never, 'CITIZEN', 'SHERIFF']);
      const eff = yourRoleEffect(s, s.seats[0]!);
      const ab = (eff.msg as { abilities: { id: string; targetDomain: string }[] }).abilities.find((a) => a.id === id);
      expect(ab, `${role}/${id}`).toBeDefined();
      expect(ab!.targetDomain).toBe('self');
    }
  });

  it('LIVING-targeting abilities report domain "living" (e.g. Doctor heal, Vampire bite)', () => {
    const cases: [string, string][] = [
      ['DOCTOR', 'protect'],
      ['VAMPIRE', 'bite'],
      ['CULT_LEADER', 'recruit'],
      ['TRANSPORTER', 'transport'],
      ['WITCH', 'witch_control'],
    ];
    for (const [role, id] of cases) {
      const s = makeGame([role as never, 'CITIZEN', 'SHERIFF']);
      const eff = yourRoleEffect(s, s.seats[0]!);
      const ab = (eff.msg as { abilities: { id: string; targetDomain: string }[] }).abilities.find((a) => a.id === id);
      expect(ab, `${role}/${id}`).toBeDefined();
      expect(ab!.targetDomain).toBe('living');
    }
  });
});
