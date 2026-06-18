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

  // --- Triad faction (second evil killing faction) -------------------------

  it('Triad wins at parity (triadCount >= rest, no Mafia, no SK)', () => {
    // 2 triad, 2 town → triadCount(2) >= rest(2) ⇒ triad win.
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'CITIZEN', 'SHERIFF']);
    const win = checkWin(s);
    expect(win).toMatchObject({ reason: 'triad_parity', winners: ['TRIAD'] });
  });

  it('Town wins only when NO Mafia, NO Triad, and NO SK remain', () => {
    const s = makeGame(['SHERIFF', 'DOCTOR', 'CITIZEN']);
    expect(checkWin(s)).toMatchObject({ reason: 'town_elimination', winners: ['TOWN'] });
  });

  it('Town does NOT win while a Triad lives (a lone Triad member among town)', () => {
    // 1 triad + 3 town: no parity yet, but Triad alive ⇒ town cannot win.
    const s = makeGame(['VANGUARD', 'CITIZEN', 'SHERIFF', 'DOCTOR']);
    expect(checkWin(s)).toBeNull();
  });

  it('Triad does NOT win while a Mafia lives (two evil factions ⇒ continue)', () => {
    // 2 triad, 1 mafia: Triad at parity vs the rest, but Mafia alive blocks it.
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'MAFIOSO']);
    expect(checkWin(s)).toBeNull();
  });

  it('Triad does NOT win while a Serial Killer lives', () => {
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'SERIAL_KILLER']);
    // Triad at parity but SK alive blocks the triad win; SK not last either.
    expect(checkWin(s)).toBeNull();
  });

  it('coexistence: Mafia + Triad + Town alive ⇒ game continues (no premature end)', () => {
    const s = makeGame(['GODFATHER', 'DRAGON_HEAD', 'CITIZEN', 'SHERIFF', 'DOCTOR']);
    expect(checkWin(s)).toBeNull();
    expect(checkWin(s, { atDayVotingStart: true })).toBeNull();
  });

  it('Mafia-vs-Triad: Mafia wins once the Triad is wiped (mafia parity)', () => {
    // After the Triad is gone: 2 mafia vs 1 town ⇒ mafia parity.
    const s = makeGame(['GODFATHER', 'MAFIOSO', 'CITIZEN']);
    expect(checkWin(s)).toMatchObject({ reason: 'mafia_parity', winners: ['MAFIA'] });
  });

  it('Mafia-vs-Triad: Triad wins once the Mafia is wiped (triad parity)', () => {
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'CITIZEN']);
    expect(checkWin(s)).toMatchObject({ reason: 'triad_parity', winners: ['TRIAD'] });
  });

  it('Mafia-vs-Triad pure endgame: larger faction wins at DAY_VOTING start', () => {
    // 2 mafia vs 1 triad, nothing else ⇒ Mafia (larger) wins the deadlock.
    const s = makeGame(['GODFATHER', 'MAFIOSO', 'ENFORCER']);
    expect(checkWin(s, { atDayVotingStart: true })).toMatchObject({
      reason: 'one_v_one',
      winners: ['MAFIA'],
    });
  });

  it('Mafia-vs-Triad pure endgame: exact tie continues (no winner)', () => {
    // 1 mafia vs 1 triad, nothing else ⇒ tie ⇒ game continues.
    const s = makeGame(['GODFATHER', 'ENFORCER']);
    expect(checkWin(s, { atDayVotingStart: true })).toBeNull();
  });

  it('SK vs lone Triad ⇒ SK wins (1v1 auto-resolve at DAY_VOTING start)', () => {
    const s = makeGame(['SERIAL_KILLER', 'ENFORCER']);
    expect(checkWin(s, { atDayVotingStart: true })).toMatchObject({
      reason: 'one_v_one',
      winners: ['SERIAL_KILLER'],
    });
  });

  it('SK wins as last killer when only SK + benign remain (no Mafia, no Triad)', () => {
    const s = makeGame(['SERIAL_KILLER', 'SURVIVOR']);
    expect(checkWin(s)).toMatchObject({ reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] });
  });

  it('stalemate: larger evil faction wins; Triad beats Mafia on a tie', () => {
    // 2 triad, 2 mafia → tie ⇒ Triad (priority Triad > Mafia in the ladder).
    const s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'GODFATHER', 'MAFIOSO']);
    s.quietNights = 3;
    expect(checkStalemate(s)).toMatchObject({ reason: 'stalemate', winners: ['TRIAD'] });
  });

  it('Triad win at NIGHT resolution emits game_over with TRIAD in winners', () => {
    let s = makeGame(['DRAGON_HEAD', 'ENFORCER', 'CITIZEN']);
    s = toFirstNight(s);
    // Triad kills the lone citizen → triad parity at night resolution.
    s = night(s, 0, 'triad_control', 2);
    s = night(s, 1, 'kill_triad', 2);
    const { state, effects } = resolveNightPhase(s);
    expect(state.gameOver).not.toBeNull();
    const go = effects.find((e) => e.msg.type === 'game_over');
    expect(go).toBeTruthy();
    if (go && go.msg.type === 'game_over') {
      expect(go.msg.winners).toContain('TRIAD');
    }
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
