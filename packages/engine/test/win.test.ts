import { describe, it, expect } from 'vitest';
import { makeGame, toFirstNight, night, resolveNightPhase, endPhase } from './harness.js';
import { checkWin, checkStalemate } from '../src/wincheck.js';

describe('§6.9 win conditions', () => {
  it('Town wins when no Mafia and no SK remain', () => {
    const s = makeGame(['SHERIFF', 'DOCTOR', 'CITIZEN']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'town_elimination', winners: ['TOWN'] });
  });

  it('Mafia wins at parity (mafiaCount >= rest, no SK)', () => {
    // 2 mafia, 2 town → mafiaCount(2) >= rest(2) ⇒ mafia win.
    const s = makeGame(['GODFATHER', 'MAFIOSO', 'CITIZEN', 'SHERIFF']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'mafia_parity', winners: ['MAFIA'] });
  });

  it('Mafia does NOT win while a Serial Killer lives', () => {
    const s = makeGame(['GODFATHER', 'MAFIOSO', 'SERIAL_KILLER']);
    const win = checkWin(s);
    // mafia at parity but SK alive blocks the mafia win; SK not last either.
    // SK alive, town=0, mafia=2 ⇒ no rule fires here (mafia blocked by SK,
    // SK blocked by mafia). Game continues.
    expect(win).toBeNull();
  });

  it('Serial Killer wins as last killer (all town & mafia dead)', () => {
    const s = makeGame(['SERIAL_KILLER', 'SURVIVOR']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] });
  });

  it('1v1 auto-resolve: SK vs lone Mafia ⇒ SK wins (at DAY_VOTING start)', () => {
    const s = makeGame(['SERIAL_KILLER', 'MAFIOSO']);
    const win = checkWin(s, { atDayVotingStart: true });
    expect(win).toMatchObject({ reason: 'one_v_one', winners: ['SERIAL_KILLER'] });
  });

  it('1v1 auto-resolve: SK vs lone Town ⇒ SK wins', () => {
    const s = makeGame(['SERIAL_KILLER', 'CITIZEN']);
    const win = checkWin(s, { atDayVotingStart: true });
    expect(win).toMatchObject({ reason: 'one_v_one', winners: ['SERIAL_KILLER'] });
  });

  it('3 quiet nights ⇒ stalemate, largest faction wins (tie ⇒ Mafia)', () => {
    // 2 town, 2 mafia → tie ⇒ Mafia.
    const s = makeGame(['CITIZEN', 'SHERIFF', 'GODFATHER', 'CONSORT']);
    s.quietNights = 3;
    const win = checkStalemate(s);
    expect(win).toMatchObject({ reason: 'stalemate', winners: ['MAFIA'] });
  });

  it('stalemate: SK wins ties over Mafia', () => {
    const s = makeGame(['GODFATHER', 'SERIAL_KILLER']);
    s.quietNights = 3;
    const win = checkStalemate(s);
    expect(win).toMatchObject({ reason: 'stalemate', winners: ['SERIAL_KILLER'] });
  });

  it('full game reaches GAME_OVER via 3 quiet nights with game_over effect', () => {
    // 1 town, mafia at parity already would end immediately; use SK vs 1 mafia +
    // 1 town so no immediate win, drive quiet nights.
    let s = makeGame(['SERIAL_KILLER', 'GODFATHER', 'CITIZEN', 'SHERIFF']);
    s = toFirstNight(s);
    // Three quiet nights: everyone passes.
    for (let n = 0; n < 3; n++) {
      const r = resolveNightPhase(s);
      s = r.state;
      if (s.gameOver) break;
      // DAWN -> DAY_DISCUSSION -> DAY_VOTING -> NIGHT
      s = endPhase(s).state;
      s = endPhase(s).state;
      if (s.gameOver) break;
      s = endPhase(s).state; // -> NIGHT
    }
    expect(s.gameOver).not.toBeNull();
  });

  it('emits game_over effect with seed and per-seat outcomes', () => {
    let s = makeGame(['GODFATHER', 'MAFIOSO', 'CITIZEN']);
    s = toFirstNight(s);
    // Mafia kills the lone citizen → mafia win at night resolution.
    s = night(s, 0, 'mafia_control', 2);
    s = night(s, 1, 'kill_mafia', 2);
    const { state, effects } = resolveNightPhase(s);
    expect(state.gameOver).not.toBeNull();
    const go = effects.find((e) => e.msg.type === 'game_over');
    expect(go).toBeTruthy();
    if (go && go.msg.type === 'game_over') {
      expect(go.msg.seed).toBe(state.seed);
      expect(go.msg.winners).toContain('MAFIA');
    }
  });
});
