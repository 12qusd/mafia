import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, toNextNight } from './harness.js';
import { yourRoleEffect } from '../src/roleinfo.js';

/**
 * Vampire conversion-faction golden cases (Vampire faction).
 *
 * Vampires win by CONVERSION + parity, not by a faction kill. Each night the
 * lowest-seat living vampire may bite; a successful bite TURNS a TOWN/benign
 * target into a new Vampire (role + faction change). The Vampire Hunter stakes
 * any vampire that bites it and retires to a Vigilante when no vampire remains.
 * The knowledge-isolated design means NO vampire chat and NO roster — verified
 * here via your_role.
 */

describe('Vampire bite / conversion', () => {
  it('a bite turns a Town citizen into a Vampire (role + faction change)', () => {
    // 0 Vampire, 1 Citizen, 2 Sheriff
    let s = makeGame(['VAMPIRE', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.seats[1]!.role).toBe('VAMPIRE');
    expect(state.seats[1]!.faction).toBe('VAMPIRE');
    const conv = state.traces.find((t) => t.step === 'convert');
    expect(conv).toMatchObject({ step: 'convert', vampire: 0, target: 1, converted: true, staked: false });
  });

  it('the converted seat is told privately "turned" and no one else is', () => {
    let s = makeGame(['VAMPIRE', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1);
    const { effects } = resolveNightPhase(s);
    const turned = effects.filter(
      (e) => (e.msg as { type?: string; kind?: string }).type === 'private_result' &&
        (e.msg as { kind?: string }).kind === 'turned',
    );
    expect(turned).toHaveLength(1);
    // Addressed to the converted seat (1) ALONE — never to anyone else.
    expect(turned[0]!.to).toEqual([1]);
  });

  it('a bite FAILS against a night-immune target (Serial Killer)', () => {
    let s = makeGame(['VAMPIRE', 'SERIAL_KILLER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1); // bite the SK (night-immune + not convertible)
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.role).toBe('SERIAL_KILLER');
    expect(state.seats[1]!.faction).toBe('NEUTRAL_KILLING');
    const conv = state.traces.find((t) => t.step === 'convert');
    expect(conv).toMatchObject({ converted: false });
  });

  it('a bite FAILS against a Mafia seat (only Town/benign are convertible)', () => {
    let s = makeGame(['VAMPIRE', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1); // bite the mafioso → not convertible
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.faction).toBe('MAFIA');
    const conv = state.traces.find((t) => t.step === 'convert');
    expect(conv).toMatchObject({ converted: false });
  });

  it('a NEUTRAL_BENIGN seat (Survivor) IS convertible', () => {
    let s = makeGame(['VAMPIRE', 'SURVIVOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.faction).toBe('VAMPIRE');
  });

  it('only ONE vampire bites per night — the lowest-seat vampire wins', () => {
    // 0 Vampire, 1 Vampire, 2 Citizen, 3 Citizen. Both bite different targets;
    // only the lowest-seat (0) bite resolves.
    let s = makeGame(['VAMPIRE', 'VAMPIRE', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 2);
    s = night(s, 1, 'bite', 3);
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.faction).toBe('VAMPIRE'); // seat 0's bite landed
    expect(state.seats[3]!.faction).toBe('TOWN'); // seat 1's bite was dropped
    const converts = state.traces.filter((t) => t.step === 'convert');
    expect(converts).toHaveLength(1);
    expect(converts[0]).toMatchObject({ vampire: 0, target: 2, converted: true });
  });

  it('a jailed bite target is unreachable — no conversion', () => {
    // 0 Jailor, 1 Vampire, 2 Citizen. Jailor jails the citizen the vampire bites.
    let s = makeGame(['JAILOR', 'VAMPIRE', 'CITIZEN']);
    s = toFirstNight(s);
    s.jailTarget = 2;
    s = night(s, 1, 'bite', 2);
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.faction).toBe('TOWN');
    const conv = state.traces.find((t) => t.step === 'convert');
    expect(conv).toMatchObject({ converted: false });
  });

  it('a converted vampire grows the faction toward a parity win', () => {
    // 0 Vampire, 1 Citizen, 2 Citizen, 3 Sheriff. After one conversion: 2 vampires
    // vs 2 town — not yet parity (2 >= 2 is parity!). Use 5 seats so it is not.
    let s = makeGame(['VAMPIRE', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1);
    const { state } = resolveNightPhase(s);
    const vamps = state.seats.filter((x) => x.alive && x.faction === 'VAMPIRE').length;
    expect(vamps).toBe(2);
    expect(state.gameOver).toBeNull(); // 2 vampires vs 3 town — game continues
  });
});

describe('Vampire Hunter (the counter)', () => {
  it('stakes a vampire that bites it (vampire dies, no conversion)', () => {
    // 0 Vampire, 1 Vampire Hunter, 2 Citizen. The vampire bites the Hunter.
    let s = makeGame(['VAMPIRE', 'VAMPIRE_HUNTER', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'bite', 1); // bite the Hunter → staked
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(false); // vampire staked
    expect(state.seats[0]!.deathCause).toBe('staked');
    // The Hunter is NOT turned.
    expect(state.seats[1]!.faction).toBe('TOWN');
    const conv = state.traces.find((t) => t.step === 'convert');
    expect(conv).toMatchObject({ converted: false, staked: true });
  });

  it('an active check learns a vampire is a vampire, and a townsman is not', () => {
    let s = makeGame(['VAMPIRE_HUNTER', 'VAMPIRE', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'vampire_check', 1); // check the vampire
    const r = resolveNightPhase(s);
    const checkV = r.state.traces.find((t) => t.step === 'vampire_check' && t.target === 1);
    expect(checkV).toMatchObject({ isVampire: true });

    // Fresh game: check a citizen.
    let s2 = makeGame(['VAMPIRE_HUNTER', 'VAMPIRE', 'CITIZEN']);
    s2 = toFirstNight(s2);
    s2 = night(s2, 0, 'vampire_check', 2); // check the citizen
    const r2 = resolveNightPhase(s2);
    const checkC = r2.state.traces.find((t) => t.step === 'vampire_check' && t.target === 2);
    expect(checkC).toMatchObject({ isVampire: false });
  });

  it('retires to a Vigilante once no vampires remain', () => {
    // 0 Vigilante, 1 Vampire Hunter, 2 Vampire, 3 Citizen, 4 Citizen.
    // The Vigilante guns down the lone Vampire on night 2 → no vampires left → the
    // Hunter becomes a Vigilante.
    let s = makeGame(['VIGILANTE', 'VAMPIRE_HUNTER', 'VAMPIRE', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    // Night 1: pass (vigilante can't shoot N1). Advance to night 2.
    s = toNextNight(s);
    s = night(s, 0, 'kill_vigilante', 2); // shoot the vampire
    const { state } = resolveNightPhase(s);
    expect(state.seats[2]!.alive).toBe(false); // vampire dead
    expect(state.seats[1]!.role).toBe('VIGILANTE'); // hunter retired
    expect(state.seats[1]!.faction).toBe('TOWN');
    const promo = state.traces.find(
      (t) => t.step === 'promotion' && t.kind === 'hunter_to_vigilante',
    );
    expect(promo).toMatchObject({ kind: 'hunter_to_vigilante', seat: 1 });
  });
});

describe('Vampire §5 knowledge-isolation (NO chat, NO roster)', () => {
  it('your_role delivers NO mates to a vampire seat', () => {
    const s = makeGame(['VAMPIRE', 'VAMPIRE', 'CITIZEN', 'SHERIFF']);
    for (const seat of s.seats) {
      const eff = yourRoleEffect(s, seat);
      expect(eff.to).toEqual([seat.seat]);
      const msg = eff.msg as { mates?: number[] };
      // Vampires (like Town) get NO faction roster — each hunts alone.
      expect(msg.mates).toBeUndefined();
    }
  });
});
