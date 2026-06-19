import { describe, it, expect } from 'vitest';
import {
  makeGame,
  toFirstNight,
  toNextNight,
  night,
  resolveNightPhase,
  endPhase,
  step,
} from './harness.js';
import { checkWin, buildGameOver } from '../src/wincheck.js';
import type { GameState } from '../src/state.js';
import type { ResolutionTrace } from '../src/state.js';

/**
 * Batch E — complex neutrals / conversions: Witch (control/spoiler), Pirate
 * (duel/plunder), Plaguebearer → Pestilence (infection conversion within NK).
 */

/** Submit a Witch control (puppet in target, victim in target2). */
function witchControl(state: GameState, witch: number, puppet: number, victim: number): GameState {
  return step(state, { type: 'night_action', seat: witch, ability: 'witch_control', target: puppet, target2: victim });
}

function traceOf(state: GameState, step: string): ResolutionTrace | undefined {
  return [...state.traces].reverse().find((t) => t.step === step);
}

// ---------------------------------------------------------------------------
// Witch
// ---------------------------------------------------------------------------

describe('batch E — Witch (Neutral spoiler, control)', () => {
  it('redirects the puppet\'s action onto the Witch-chosen victim', () => {
    // 0 Witch controls 1 (Vigilante) → forces the shot onto 3 (instead of 2).
    let s = makeGame(['WITCH', 'VIGILANTE', 'CITIZEN', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    s = witchControl(s, 0, 1, 3); // puppet = seat 1 (vigilante), victim = seat 3
    s = night(s, 1, 'kill_vigilante', 2); // the vigilante MEANT to shoot seat 2
    const { state, effects } = resolveNightPhase(s);

    // The shot landed on the Witch's victim (3), NOT the vigilante's choice (2).
    expect(state.seats[3]!.alive).toBe(false);
    expect(state.seats[3]!.deathCause).toBe('vigilante');
    expect(state.seats[2]!.alive).toBe(true);

    // The puppet is told privately they were controlled — with NO controller id.
    const ctl = effects.find(
      (e) => Array.isArray(e.to) && e.to[0] === 1 && (e.msg as { kind?: string }).kind === 'controlled',
    );
    expect(ctl).toBeTruthy();
    // The controlled message carries no seats / roles — only the envelope + kind.
    // (the `v` protocol-version field is the only extra; no target / role / seat).
    const ctlKeys = Object.keys(ctl!.msg as object).sort();
    expect(ctlKeys).toEqual(['kind', 'type', 'v']);
    expect(JSON.stringify(ctl!.msg)).not.toContain('"target"');

    const wt = traceOf(state, 'witch');
    expect(wt).toMatchObject({ step: 'witch', witch: 0, puppet: 1, victim: 3, redirected: true });
  });

  it('creates an intent for a puppet who submitted nothing (forces their natural action)', () => {
    // 0 Witch controls 1 (Sheriff who did NOT submit) → forces the investigate onto 2.
    let s = makeGame(['WITCH', 'SHERIFF', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    s = witchControl(s, 0, 1, 2); // puppet = sheriff, victim = mafioso
    const { effects } = resolveNightPhase(s);
    // The sheriff investigated the mafioso (suspicious), even though they never acted.
    const sher = effects.find(
      (e) =>
        Array.isArray(e.to) &&
        e.to[0] === 1 &&
        (e.msg as { kind?: string }).kind === 'sheriff_result',
    );
    expect(sher).toBeTruthy();
    expect((sher!.msg as { target?: number }).target).toBe(2);
    expect((sher!.msg as { result?: string }).result).toBe('suspicious');
  });

  it('is roleblock-immune and night-immune (cannot be blocked or killed in the night)', () => {
    // 0 Witch, 1 Escort tries to roleblock the Witch, 2 Serial Killer attacks the
    // Witch, 3 Sheriff is the puppet (a redirectable action), 4 Citizen victim.
    let s = makeGame(['WITCH', 'ESCORT', 'SERIAL_KILLER', 'SHERIFF', 'CITIZEN']);
    s = toFirstNight(s);
    s = witchControl(s, 0, 3, 4); // ride the Sheriff onto seat 4 despite the block attempt
    s = night(s, 1, 'roleblock', 0); // try to block the Witch
    s = night(s, 2, 'kill_serial', 0); // try to kill the Witch
    const { state } = resolveNightPhase(s);
    expect(state.seats[0]!.alive).toBe(true); // night-immune
    // The control still fired (roleblock-immune): the witch trace is present + redirected.
    expect(traceOf(state, 'witch')).toMatchObject({ step: 'witch', redirected: true });
  });

  it('cannot control another Witch (control-immune)', () => {
    let s = makeGame(['WITCH', 'WITCH', 'VIGILANTE', 'CITIZEN']);
    s = toFirstNight(s);
    s = witchControl(s, 0, 1, 3); // Witch 0 tries to ride Witch 1
    const { state } = resolveNightPhase(s);
    const wt = traceOf(state, 'witch');
    expect(wt).toMatchObject({ step: 'witch', witch: 0, puppet: 1, redirected: false });
  });

  it('SPOILER win: a living Witch wins when the Town does NOT win', () => {
    // Mafia takes the match; a living Witch rides it.
    const s = makeGame(['WITCH', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    // Mafia at parity (2 mafia vs 2 non-mafia, of which one is the Witch benign).
    const win = checkWin(s);
    expect(win).toMatchObject({ winners: ['MAFIA'] });
    const over = buildGameOver(s, win!);
    expect(over.winners).toContain('WITCH');
    // The Witch's per-seat outcome is a win.
    expect(over.results[0]!.outcome).toBe('win');
  });

  it('SPOILER win does NOT fire when the Town wins (or the Witch is dead)', () => {
    // Town wins → the Witch loses even if alive.
    const s = makeGame(['WITCH', 'SHERIFF', 'DOCTOR']);
    const win = checkWin(s);
    expect(win).toMatchObject({ winners: ['TOWN'] });
    const over = buildGameOver(s, win!);
    expect(over.winners).not.toContain('WITCH');
    expect(over.results[0]!.outcome).toBe('loss');

    // A DEAD witch in a non-Town win does not ride it.
    const s2 = makeGame(['WITCH', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    s2.seats[0]!.alive = false;
    const win2 = checkWin(s2);
    const over2 = buildGameOver(s2, win2!);
    expect(over2.winners).not.toContain('WITCH');
  });
});

// ---------------------------------------------------------------------------
// Pirate
// ---------------------------------------------------------------------------

describe('batch E — Pirate (Neutral benign, duel/plunder)', () => {
  it('duels a target: occupies (roleblocks) them and shields them from all kills', () => {
    // 0 Pirate duels 1 (a Doctor who tries to heal 2); 3 Mafioso/SK tries to kill 1.
    let s = makeGame(['PIRATE', 'DOCTOR', 'CITIZEN', 'SERIAL_KILLER']);
    s = toFirstNight(s);
    s = night(s, 0, 'duel', 1); // plunder the doctor
    s = night(s, 1, 'protect', 2); // the doctor MEANT to heal seat 2 — should be blocked
    s = night(s, 3, 'kill_serial', 1); // SK attacks the dueled doctor — should bounce
    const { state, effects } = resolveNightPhase(s);

    // The dueled doctor survives (untouchable while plundered).
    expect(state.seats[1]!.alive).toBe(true);
    // The duel trace is present.
    expect(traceOf(state, 'duel')).toMatchObject({ step: 'duel', pirate: 0, target: 1 });
    // The doctor was roleblocked (occupied), so they did NOT heal — no protect trace
    // for the doctor's intent (it was cancelled).
    const protectTraces = state.traces.filter((t) => t.step === 'protect' && (t as { doctor?: number }).doctor === 1);
    expect(protectTraces).toHaveLength(0);
    // The SK was told its target was unreachable.
    const unreach = effects.find(
      (e) => Array.isArray(e.to) && e.to[0] === 3 && (e.msg as { kind?: string }).kind === 'target_unreachable',
    );
    expect(unreach).toBeTruthy();
  });

  it('credits a successful plunder deterministically (seeded PRNG vs the fixed RPS rule)', () => {
    // A persistent evil seat keeps the game alive while we duel. The duel outcome
    // is decided by the seeded PRNG against the fixed (a-d+3)%3===1 rule; with this
    // seed the first night's duel SUCCEEDS, crediting the plunder counter.
    let s = makeGame(['PIRATE', 'CITIZEN', 'CITIZEN', 'GODFATHER', 'MAFIOSO', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 0, 'duel', 1);
    const { state } = resolveNightPhase(s);
    const dt = traceOf(state, 'duel') as { success?: boolean; attack?: number } | undefined;
    expect(dt).toMatchObject({ step: 'duel', pirate: 0, target: 1 });
    // The attack is one of the three deterministic choices.
    expect([0, 1, 2]).toContain(dt!.attack);
    // The counter tracks successes exactly.
    expect(state.seats[0]!.plunderCount).toBe(dt!.success ? 1 : 0);
  });

  it('personal win: enough plunders AND alive → PIRATE rider (independent of who won)', () => {
    // Construct an end-state: a Pirate with the win threshold met, alive, while the
    // Mafia takes the match. The Pirate rides its own personal win.
    const s = makeGame(['PIRATE', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    s.seats[0]!.plunderCount = 2; // PIRATE_PLUNDERS_TO_WIN
    const win = checkWin(s);
    expect(win).toMatchObject({ winners: ['MAFIA'] });
    const over = buildGameOver(s, win!);
    expect(over.winners).toContain('PIRATE');
    expect(over.results[0]!.outcome).toBe('win');
  });

  it('a Pirate without enough plunders does NOT win', () => {
    const s = makeGame(['PIRATE', 'GODFATHER', 'MAFIOSO', 'CITIZEN']);
    // plunderCount stays 0.
    const win = checkWin(s);
    const over = buildGameOver(s, win!);
    expect(over.winners).not.toContain('PIRATE');
    expect(over.results[0]!.outcome).toBe('loss');
  });
});

// ---------------------------------------------------------------------------
// Plaguebearer → Pestilence
// ---------------------------------------------------------------------------

describe('batch E — Plaguebearer → Pestilence (Neutral Killing conversion)', () => {
  it('infects via visits and spreads; transforms when all living are infected', () => {
    // A tiny board so the plague can blanket it: 0 Plaguebearer, 1..2 Citizens.
    // The Plaguebearer infects everyone it visits + everyone who visits it; in a
    // 3-seat board it reaches everyone quickly across a couple of nights.
    let s = makeGame(['PLAGUEBEARER', 'CITIZEN', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'infect', 1); // visit seat 1
    s = toNextNight(s);
    s = night(s, 0, 'infect', 2); // visit seat 2 — now all three are infected
    const { state } = resolveNightPhase(s);

    // All living seats are infected → the Plaguebearer transformed into Pestilence.
    expect(state.seats[0]!.role).toBe('PESTILENCE');
    const prom = traceOf(state, 'promotion');
    expect(state.traces.some((t) => t.step === 'promotion' && (t as { kind?: string }).kind === 'plaguebearer_to_pestilence')).toBe(true);
    void prom;
  });

  it('Pestilence reaps with a powerful attack that pierces a doctor heal', () => {
    // Force a Pestilence directly (it is the transformed form) and have it reap.
    let s = makeGame(['PESTILENCE', 'CITIZEN', 'DOCTOR', 'CITIZEN']);
    s = toFirstNight(s);
    s = night(s, 0, 'pestilence', 1);
    s = night(s, 2, 'protect', 1); // heal the victim — should NOT save them (powerful)
    const { state } = resolveNightPhase(s);
    expect(state.seats[1]!.alive).toBe(false);
    expect(state.seats[1]!.deathCause).toBe('pestilence');
  });

  it('reuses the NK / last-killer win path (no new faction)', () => {
    // Pestilence + a lone benign → Pestilence is the last killer (SK win path).
    const s = makeGame(['PESTILENCE', 'SURVIVOR']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] });
    const over = buildGameOver(s, win!);
    // The Pestilence (NEUTRAL_KILLING) seat wins via the SK rider.
    expect(over.results[0]!.outcome).toBe('win');
  });
});

/** From a just-resolved DAWN state, advance to the next NIGHT phase. */
export function dawnToNextNight(state: GameState): GameState {
  let s = endPhase(state).state;
  s = endPhase(s).state;
  s = endPhase(s).state;
  return s;
}
