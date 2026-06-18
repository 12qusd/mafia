/**
 * Win conditions & endgame (BUILD_SPEC §6.9).
 */

import type { WinningParty, SeatOutcome } from '@nocturne/shared';
import { STALEMATE_QUIET_NIGHTS } from '@nocturne/shared';
import type { GameState, SeatState, WinCheckReason, GameOverState, SeatResult } from './state.js';
import { livingSeats } from './helpers.js';

interface FactionTally {
  town: SeatState[];
  mafia: SeatState[];
  sk: SeatState[]; // serial killers (NEUTRAL_KILLING)
  benign: SeatState[]; // jester/exe/survivor (NEUTRAL_BENIGN)
}

function tally(state: GameState): FactionTally {
  const t: FactionTally = { town: [], mafia: [], sk: [], benign: [] };
  for (const s of livingSeats(state)) {
    if (s.faction === 'TOWN') t.town.push(s);
    else if (s.faction === 'MAFIA') t.mafia.push(s);
    else if (s.faction === 'NEUTRAL_KILLING') t.sk.push(s);
    else t.benign.push(s);
  }
  return t;
}

/**
 * Evaluate win conditions. `atDayVotingStart` enables the 1v1 auto-resolve which
 * only fires at the start of a DAY_VOTING (§6.9.4).
 *
 * Returns the win check result, or null if the game continues.
 */
export function checkWin(
  state: GameState,
  opts: { atDayVotingStart?: boolean } = {},
): { reason: WinCheckReason; winners: WinningParty[] } | null {
  const t = tally(state);
  const living = livingSeats(state);

  // All dead → draw (degenerate; e.g. simultaneous mutual kills).
  if (living.length === 0) {
    return { reason: 'all_dead', winners: ['DRAW'] };
  }

  const skAlive = t.sk.length > 0;
  const mafiaCount = t.mafia.length;
  const nonMafia = living.length - mafiaCount;

  // 3. Serial Killer wins if SK alive and only SK + benign neutrals remain.
  if (skAlive && t.town.length === 0 && t.mafia.length === 0) {
    return { reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] };
  }

  // 1. Town wins: no living Mafia and no living SK.
  if (mafiaCount === 0 && !skAlive) {
    return { reason: 'town_elimination', winners: ['TOWN'] };
  }

  // 2. Mafia wins: mafiaCount >= rest AND no living SK.
  if (mafiaCount > 0 && !skAlive && mafiaCount >= nonMafia) {
    return { reason: 'mafia_parity', winners: ['MAFIA'] };
  }

  // 4. 1v1 auto-resolve at start of DAY_VOTING: exactly two non-benign parties
  //    remain and neither can mechanically beat the other → priority SK>Mafia>Town.
  if (opts.atDayVotingStart) {
    const nonBenign = living.filter((s) => s.faction !== 'NEUTRAL_BENIGN');
    // SK + exactly one Mafia, no Town: SK wins (night-immune; mafia can't out-kill).
    if (skAlive && t.mafia.length === 1 && t.town.length === 0) {
      return { reason: 'one_v_one', winners: ['SERIAL_KILLER'] };
    }
    // SK + exactly one Town, no Mafia: SK wins (town can't lynch alone).
    if (skAlive && t.town.length === 1 && t.mafia.length === 0) {
      return { reason: 'one_v_one', winners: ['SERIAL_KILLER'] };
    }
    // (Mafia-vs-Town parity already covered by rule 2.)
    void nonBenign;
  }

  return null;
}

/**
 * Stalemate guard (§6.9.6): if `quietNights` reached the threshold, the game
 * ends — largest living faction wins (Town vs Mafia by count; tie ⇒ Mafia; SK
 * counts as a faction of 1 and wins ties over Mafia).
 */
export function checkStalemate(
  state: GameState,
): { reason: WinCheckReason; winners: WinningParty[] } | null {
  if (state.quietNights < STALEMATE_QUIET_NIGHTS) return null;
  const t = tally(state);

  // SK wins ties over Mafia. SK is a faction of 1 (only one SK in MVP).
  const candidates: { party: WinningParty; count: number; priority: number }[] = [];
  if (t.town.length > 0) candidates.push({ party: 'TOWN', count: t.town.length, priority: 0 });
  if (t.mafia.length > 0) candidates.push({ party: 'MAFIA', count: t.mafia.length, priority: 1 });
  if (t.sk.length > 0) candidates.push({ party: 'SERIAL_KILLER', count: t.sk.length, priority: 2 });

  if (candidates.length === 0) {
    return { reason: 'stalemate', winners: ['DRAW'] };
  }

  // Largest count wins; tie broken by priority (SK > Mafia > Town).
  candidates.sort((a, b) => b.count - a.count || b.priority - a.priority);
  return { reason: 'stalemate', winners: [candidates[0]!.party] };
}

/**
 * Build the full GameOverState: faction winners plus riders (Survivor alive,
 * Jester/Executioner personal wins), and per-seat outcomes.
 */
export function buildGameOver(
  state: GameState,
  base: { reason: WinCheckReason; winners: WinningParty[] },
): GameOverState {
  const winners = new Set<WinningParty>(base.winners);

  // Riders: Survivor wins if alive at game end. An Amnesiac (batch B) who never
  // remembered is a benign that also wins by surviving — it rides the SURVIVOR
  // win flag (no new WinningParty / faction logic).
  for (const s of state.seats) {
    if (s.alive && (s.role === 'SURVIVOR' || s.role === 'AMNESIAC')) winners.add('SURVIVOR');
  }
  // Jester / Executioner personal wins were recorded at lynch time.
  if (state.jesterWinners.length > 0) winners.add('JESTER');
  if (state.exeWinners.length > 0) winners.add('EXECUTIONER');

  // Guardian Angel (batch D) personal win: a still-GA seat whose assigned charge
  // is ALIVE at game end wins, regardless of which faction took the match. (A GA
  // whose charge died was already converted to a Survivor during play, so it is
  // not a GUARDIAN_ANGEL here and rides the SURVIVOR rule above instead.) Computed
  // from the final state and recorded into gaWinners (mirrors jester/exe winners).
  state.gaWinners = [];
  for (const s of state.seats) {
    if (s.role === 'GUARDIAN_ANGEL' && s.gaTarget !== null && state.seats[s.gaTarget]?.alive) {
      state.gaWinners.push(s.seat);
    }
  }
  if (state.gaWinners.length > 0) winners.add('GUARDIAN_ANGEL');

  const winnerList = [...winners];

  // Per-seat outcome.
  const results: SeatResult[] = state.seats.map((s) => {
    let outcome: SeatOutcome;
    if (s.leaving && !s.alive) {
      outcome = 'left';
    } else {
      outcome = seatWon(s, state, winnerList) ? 'win' : 'loss';
    }
    return { seat: s.seat, role: s.role, faction: s.faction, outcome };
  });

  return { winners: winnerList, results, reason: base.reason };
}

function seatWon(seat: SeatState, state: GameState, winners: WinningParty[]): boolean {
  // Draw → everyone draws (treated as loss for the outcome enum's win flag;
  // 'draw' SeatOutcome handled below).
  if (winners.includes('DRAW')) return false;

  // Personal-win riders.
  if (state.jesterWinners.includes(seat.seat)) return true;
  if (state.exeWinners.includes(seat.seat)) return true;
  if (state.gaWinners.includes(seat.seat)) return true;
  // Survivor and a never-remembered Amnesiac ride any win if alive at the end.
  if (seat.role === 'SURVIVOR' || seat.role === 'AMNESIAC') return seat.alive;

  switch (seat.faction) {
    case 'TOWN':
      return winners.includes('TOWN');
    case 'MAFIA':
      return winners.includes('MAFIA');
    case 'NEUTRAL_KILLING':
      return winners.includes('SERIAL_KILLER');
    case 'NEUTRAL_BENIGN':
      // Jester/Exe handled above; a benign with no personal win loses.
      return false;
    default:
      return false;
  }
}
