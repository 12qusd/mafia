import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, toNextNight, night, resolveNightPhase, endPhase } from './harness.js';
import { checkWin, buildGameOver } from '../src/wincheck.js';
import type { GameState } from '../src/state.js';

/** From a just-resolved DAWN state, advance to the next NIGHT phase. */
function dawnToNextNight(state: GameState): GameState {
  let s = endPhase(state).state; // DAWN → DAY_DISCUSSION
  s = endPhase(s).state; // DAY_DISCUSSION → DAY_VOTING
  s = endPhase(s).state; // DAY_VOTING → (no lynch) → NIGHT
  return s;
}

/**
 * Batch D — iconic neutrals: Werewolf, Mass Murderer, Guardian Angel, Juggernaut.
 *
 * Full-moon convention: nightNumber even ⇒ full moon. The first NIGHT is night 1
 * (odd ⇒ NOT a full moon), the second NIGHT is night 2 (even ⇒ full moon). So a
 * Werewolf cannot kill on the first night and rampages on the second.
 */

describe('batch D — Werewolf (Neutral Killing, full-moon rampage)', () => {
  it('does NOT kill on a non-full-moon night (night 1) and does not visit', () => {
    // 0 Werewolf (targets 1), 1 Citizen, 2 Lookout (watches 0 — should see nothing),
    // 3..5 Citizen.
    let s = makeGame(['WEREWOLF', 'CITIZEN', 'LOOKOUT', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s); // NIGHT 1 (odd, no full moon)
    expect(s.nightNumber).toBe(1);
    s = night(s, 0, 'rampage', 1);
    s = night(s, 2, 'watch', 0); // lookout watching the werewolf's house
    const { state, effects } = resolveNightPhase(s);

    // No one dies; the beast slept.
    for (const seat of state.seats) expect(seat.alive).toBe(true);
    const trace = state.traces.find((t) => t.step === 'rampage');
    expect(trace).toMatchObject({ step: 'rampage', werewolf: 0, fullMoon: false, victims: [] });

    // The Lookout watching the Werewolf saw NO visit from it (it stayed home).
    const look = effects.find(
      (e) =>
        Array.isArray(e.to) &&
        e.to[0] === 2 &&
        (e.msg as { kind?: string }).kind === 'lookout_result',
    );
    expect((look!.msg as { visitors?: number[] }).visitors).not.toContain(0);
  });

  it('on a full-moon night kills its target AND everyone who visited the Werewolf', () => {
    // Drive to NIGHT 2 (full moon). 0 Werewolf (targets 1), 1 Citizen (target),
    // 2 Sheriff (visits the WEREWOLF, seat 0), 3 Doctor (visits 0), 4..5 Citizen.
    let s = makeGame(['WEREWOLF', 'CITIZEN', 'SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = toNextNight(s); // NIGHT 2
    expect(s.nightNumber).toBe(2);
    s = night(s, 0, 'rampage', 1); // maul the chosen victim
    s = night(s, 2, 'investigate_sheriff', 0); // visits the werewolf → mauled
    s = night(s, 3, 'protect', 0); // visits the werewolf → mauled
    const { state } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'rampage' && (t as { fullMoon?: boolean }).fullMoon);
    expect(trace).toMatchObject({ step: 'rampage', werewolf: 0, fullMoon: true });
    // Chosen victim (1) and both visitors (2, 3) are dead from the rampage.
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[1]!.deathCause).toBe('werewolf');
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[2]!.deathCause).toBe('werewolf');
    expect(state.seats[3]!.alive).toBe(false);
    // The Werewolf itself and a non-visitor survive.
    expect(state.seats[0]!.alive).toBe(true);
    expect(state.seats[4]!.alive).toBe(true);
  });

  it('the rampage pierces a doctor heal (powerful attack)', () => {
    // NIGHT 2. 0 Werewolf (targets 1), 1 Citizen, 2 Doctor heals 1, 3..5 Citizen.
    let s = makeGame(['WEREWOLF', 'CITIZEN', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = toNextNight(s);
    s = night(s, 0, 'rampage', 1);
    s = night(s, 2, 'protect', 1); // heal the chosen victim — should NOT save them
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[1]!.deathCause).toBe('werewolf');
  });

  it('is night-immune: a serial killer that attacks the Werewolf bounces off', () => {
    // NIGHT 2. 0 Werewolf (stays home, self-target → only mauls visitors),
    // 1 Serial Killer kills the werewolf (also visits it → mauled, but immune dies?),
    // 2..5 Citizen.
    let s = makeGame(['WEREWOLF', 'SERIAL_KILLER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = toNextNight(s);
    s = night(s, 0, 'rampage', 0); // self-target: maul only visitors
    s = night(s, 1, 'kill_serial', 0); // SK attacks the werewolf and visits it
    const { state } = resolveNightPhase(s);
    // The Werewolf is night-immune → survives the SK. The SK visited the werewolf
    // and is mauled by the rampage, but the SK is ALSO night-immune → survives.
    expect(state.seats[0]!.alive).toBe(true);
    expect(state.seats[1]!.alive).toBe(true);
  });

  it('reuses the Neutral-Killing last-killer win (like the SK/Arsonist)', () => {
    // Only the Werewolf and one benign Survivor remain → NK wins as last killer.
    const s = makeGame(['WEREWOLF', 'SURVIVOR']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] });
  });
});

describe('batch D — Mass Murderer (Neutral Killing, massacre at a house)', () => {
  it('kills the resident AND every other visitor to the chosen house', () => {
    // 0 Mass Murderer (visits house 3), 1 Sheriff (visits 3), 2 Doctor (visits 3),
    // 3 Citizen (resident), 4..5 Citizen.
    let s = makeGame(['MASS_MURDERER', 'SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'massacre', 3);
    s = night(s, 1, 'investigate_sheriff', 3);
    s = night(s, 2, 'protect', 3);
    const { state } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'massacre');
    expect(trace).toMatchObject({ step: 'massacre', murderer: 0, house: 3 });
    // Resident (3) and both visitors (1, 2) die in the massacre.
    expect(state.seats[3]!.alive).toBe(false);
    expect(state.seats[3]!.deathCause).toBe('massacre');
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[2]!.deathCause).toBe('massacre');
    // The murderer and a non-visitor live.
    expect(state.seats[0]!.alive).toBe(true);
    expect(state.seats[4]!.alive).toBe(true);
  });

  it('the massacre pierces a doctor heal on the resident (powerful)', () => {
    // 0 Mass Murderer (house 3), 3 Citizen self?, 2 Doctor heals 3.
    let s = makeGame(['MASS_MURDERER', 'CITIZEN', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'massacre', 3);
    s = night(s, 2, 'protect', 3); // heal the resident — should not save them
    const { state } = resolveNightPhase(s);
    expect(state.seats[3]!.alive).toBe(false);
    expect(state.seats[3]!.deathCause).toBe('massacre');
    // The doctor (visited the house) also dies in the massacre.
    expect(state.seats[2]!.alive).toBe(false);
  });

  it('the Mass Murderer visits the house (a Lookout there sees them)', () => {
    let s = makeGame(['MASS_MURDERER', 'LOOKOUT', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'massacre', 3);
    s = night(s, 1, 'watch', 3);
    const { effects } = resolveNightPhase(s);
    const look = effects.find(
      (e) => Array.isArray(e.to) && e.to[0] === 1 && (e.msg as { kind?: string }).kind === 'lookout_result',
    );
    expect((look!.msg as { visitors?: number[] }).visitors).toContain(0);
  });
});

describe('batch D — Guardian Angel (Neutral Benign, protect + personal win)', () => {
  it('shields its assigned charge from an attack', () => {
    // 0 Guardian Angel (charge 1), 1 Citizen (charge), 2 Godfather, 3 Mafioso kills 1.
    let s = makeGame(['GUARDIAN_ANGEL', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN']);
    s.seats[0]!.gaTarget = 1;
    s = toFirstNight(s);
    s = night(s, 0, 'shield', 1);
    s = night(s, 2, 'mafia_control', 1);
    s = night(s, 3, 'kill_mafia', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(true); // the charge was shielded
    const trace = state.traces.find((t) => t.step === 'shield');
    expect(trace).toMatchObject({ step: 'shield', angel: 0, charge: 1 });
  });

  it('only shields its OWN assigned charge, not an arbitrary seat', () => {
    // The GA is assigned charge 1 but tries to shield seat 4 (illegal) — no shield.
    let s = makeGame(['GUARDIAN_ANGEL', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN']);
    s.seats[0]!.gaTarget = 1;
    s = toFirstNight(s);
    s = night(s, 0, 'shield', 4); // not the assigned charge
    s = night(s, 2, 'mafia_control', 4);
    s = night(s, 3, 'kill_mafia', 4);
    const { state } = resolveNightPhase(s);
    expect(state.seats[4]!.alive).toBe(false); // not protected (illegal target)
    expect(state.traces.find((t) => t.step === 'shield')).toBeUndefined();
  });

  it('PERSONAL WIN: GA wins if its charge is alive at game end', () => {
    // Town wins; the GA's charge (a townsman) is alive ⇒ GA rides a personal win.
    const s = makeGame(['GUARDIAN_ANGEL', 'CITIZEN', 'SHERIFF']);
    s.seats[0]!.gaTarget = 1;
    const base = checkWin(s); // town_elimination (no mafia/SK)
    expect(base).toMatchObject({ winners: ['TOWN'] });
    const over = buildGameOver(s, base!);
    expect(over.winners).toContain('TOWN');
    expect(over.winners).toContain('GUARDIAN_ANGEL');
    expect(s.gaWinners).toContain(0);
    // The GA seat's own outcome is a win.
    const gaResult = over.results.find((r) => r.seat === 0);
    expect(gaResult!.outcome).toBe('win');
  });

  it('GA LOSES (no personal win) if its charge is dead at game end', () => {
    // The charge is dead; the GA was converted to a Survivor during play (so it is
    // not a GUARDIAN_ANGEL at game over). Here we model the post-death state: the
    // GA already became a Survivor and is alive → it rides the SURVIVOR rule, but
    // the GUARDIAN_ANGEL party is NOT awarded.
    const s = makeGame(['SURVIVOR', 'CITIZEN', 'SHERIFF']); // seat 0 is the ex-GA Survivor
    s.seats[1]!.alive = false; // the former charge died
    const base = checkWin(s);
    const over = buildGameOver(s, base!);
    expect(over.winners).not.toContain('GUARDIAN_ANGEL');
  });

  it('becomes a Survivor when its charge dies during play', () => {
    // 0 Guardian Angel (charge 1), 1 Citizen, 2 Godfather, 3 Mafioso kills 1.
    // The GA does NOT shield (or shields elsewhere); the charge dies → GA converts.
    let s = makeGame(['GUARDIAN_ANGEL', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'CITIZEN']);
    s.seats[0]!.gaTarget = 1;
    s = toFirstNight(s);
    s = night(s, 2, 'mafia_control', 1);
    s = night(s, 3, 'kill_mafia', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false);
    // The GA is converted to a Survivor; its charge link is cleared.
    expect(state.seats[0]!.role).toBe('SURVIVOR');
    expect(state.seats[0]!.faction).toBe('NEUTRAL_BENIGN');
    expect(state.seats[0]!.gaTarget).toBeNull();
    const trace = state.traces.find((t) => t.step === 'promotion' && (t as { kind?: string }).kind === 'guardian_to_survivor');
    expect(trace).toBeDefined();
  });
});

describe('batch D — Juggernaut (Neutral Killing, escalating)', () => {
  it('cannot kill on a non-full-moon night before its first kill', () => {
    // NIGHT 1 (no full moon), killCount 0 → the Juggernaut is gated and kills no one.
    let s = makeGame(['JUGGERNAUT', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    expect(s.nightNumber).toBe(1);
    s = night(s, 0, 'juggernaut', 1);
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(true);
    expect(state.traces.find((t) => t.step === 'juggernaut')).toBeUndefined();
  });

  it('kills on a full-moon night and banks the kill, then may kill any night after', () => {
    // NIGHT 2 (full moon): the first kill lands. killCount → 1.
    let s = makeGame(['JUGGERNAUT', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = toNextNight(s); // NIGHT 2 (full moon)
    expect(s.nightNumber).toBe(2);
    s = night(s, 0, 'juggernaut', 1);
    let r = resolveNightPhase(s);
    expect(r.state.seats[1]!.alive).toBe(false);
    expect(r.state.seats[1]!.deathCause).toBe('juggernaut');
    expect(r.state.seats[0]!.killCount).toBe(1);

    // Advance to NIGHT 3 (odd, NOT a full moon) — with a kill banked it may still kill.
    let s3 = dawnToNextNight(r.state);
    expect(s3.nightNumber).toBe(3);
    s3 = night(s3, 0, 'juggernaut', 2);
    r = resolveNightPhase(s3);
    expect(r.state.seats[2]!.alive).toBe(false);
    expect(r.state.seats[0]!.killCount).toBe(2);
  });

  it('once powered up, the attack pierces a heal AND mauls visitors to the victim', () => {
    // Pre-set killCount to the power threshold so the very first resolved kill is
    // powerful. NIGHT 2 (full moon, though the gate is moot with a kill banked).
    let s = makeGame(['JUGGERNAUT', 'CITIZEN', 'SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN']);
    s.seats[0]!.killCount = 2; // >= threshold ⇒ powerful
    s = toFirstNight(s);
    s = toNextNight(s); // NIGHT 2
    s = night(s, 0, 'juggernaut', 1); // crush seat 1
    s = night(s, 2, 'investigate_sheriff', 1); // a visitor to the victim's house
    s = night(s, 3, 'protect', 1); // doctor heals the victim — should NOT save them
    const { state } = resolveNightPhase(s);

    const trace = state.traces.find((t) => t.step === 'juggernaut');
    expect(trace).toMatchObject({ step: 'juggernaut', juggernaut: 0, target: 1, powerful: true });
    // The victim dies despite the heal (powerful pierces).
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[1]!.deathCause).toBe('juggernaut');
    // Both visitors to the victim's house — the Sheriff (2) and the Doctor (3) —
    // are mauled by the rampage too.
    expect(state.seats[2]!.alive).toBe(false);
    expect(state.seats[3]!.alive).toBe(false);
    // killCount grows by the three kills landed (victim + two visitors): 2 → 5.
    expect(state.seats[0]!.killCount).toBe(5);
  });

  it('a weak (un-powered) Juggernaut attack is a BASIC attack a doctor can heal', () => {
    // killCount 1 (< threshold 2) ⇒ basic. NIGHT 3 (kill banked, may kill).
    let s = makeGame(['JUGGERNAUT', 'CITIZEN', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    s.seats[0]!.killCount = 1;
    s = toFirstNight(s);
    s = toNextNight(s); // N2
    s = toNextNight(s); // N3
    s = night(s, 0, 'juggernaut', 1);
    s = night(s, 2, 'protect', 1); // doctor saves the victim (basic attack)
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(true); // healed
    expect(state.seats[0]!.killCount).toBe(1); // no kill banked
  });

  it('reuses the Neutral-Killing last-killer win', () => {
    const s = makeGame(['JUGGERNAUT', 'SURVIVOR']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] });
  });
});
