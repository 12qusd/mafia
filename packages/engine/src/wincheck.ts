/**
 * Win conditions & endgame (BUILD_SPEC §6.9).
 *
 * Generalized for THREE independent evil killing factions — Mafia, Triad, and
 * Vampire. They are enemies, not allies: no two evil factions can ever co-win,
 * they must wipe each other (and any neutral killer) out first. The Vampire grows
 * by conversion rather than a faction kill, but for the win math it is just a
 * third killing faction that wins on parity. The rules (see {@link checkWin}):
 *
 *   - Town wins iff NO living Mafia, NO living Triad, NO living Vampire, and no
 *     living NK.
 *   - An evil killing faction F (Mafia | Triad | Vampire) wins iff F has living
 *     members, there are NO living members of any OTHER killing faction (the other
 *     evil factions AND no living NK), and F has reached parity with the rest
 *     (|F| >= |living non-F|).
 *   - The Serial Killer (NK) wins iff it is the last killer standing (no living
 *     Mafia, Triad, or Vampire), among only itself + benign neutrals.
 *   - If TWO OR MORE killing factions (Mafia / Triad / Vampire / NK) are alive,
 *     the game CONTINUES — no one wins yet; they fight it out.
 *
 * The 1v1 auto-resolve and the stalemate guard follow the same priority ladder:
 * SK > Vampire > Triad > Mafia > Town. A pure evil-vs-evil endgame with nothing
 * else alive resolves to the LARGER faction; an exact tie continues (the
 * auto-resolve) / draws-by-priority (the stalemate guard) — see below.
 */

import type { WinningParty, SeatOutcome } from '@nocturne/shared';
import { STALEMATE_QUIET_NIGHTS, PIRATE_PLUNDERS_TO_WIN } from '@nocturne/shared';
import type { GameState, SeatState, WinCheckReason, GameOverState, SeatResult } from './state.js';
import { livingSeats } from './helpers.js';

interface FactionTally {
  town: SeatState[];
  mafia: SeatState[];
  triad: SeatState[]; // second evil killing faction
  vampire: SeatState[]; // third evil killing faction (grows by conversion)
  sk: SeatState[]; // serial killers (NEUTRAL_KILLING)
  benign: SeatState[]; // jester/exe/survivor (NEUTRAL_BENIGN)
}

function tally(state: GameState): FactionTally {
  const t: FactionTally = { town: [], mafia: [], triad: [], vampire: [], sk: [], benign: [] };
  for (const s of livingSeats(state)) {
    if (s.faction === 'TOWN') t.town.push(s);
    else if (s.faction === 'MAFIA') t.mafia.push(s);
    else if (s.faction === 'TRIAD') t.triad.push(s);
    else if (s.faction === 'VAMPIRE') t.vampire.push(s);
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
  const triadCount = t.triad.length;
  const vampireCount = t.vampire.length;
  // The three evil killing factions, as a uniform list (parity winner + endgame
  // priority computed from this). Priority order (highest first) mirrors the
  // stalemate ladder: Vampire > Triad > Mafia. (SK sits above all of these.)
  const evilFactions: { party: WinningParty; reason: WinCheckReason; count: number; priority: number }[] = [
    { party: 'VAMPIRE', reason: 'vampire_parity', count: vampireCount, priority: 3 },
    { party: 'TRIAD', reason: 'triad_parity', count: triadCount, priority: 2 },
    { party: 'MAFIA', reason: 'mafia_parity', count: mafiaCount, priority: 1 },
  ];
  const livingEvil = evilFactions.filter((f) => f.count > 0);

  // 3. Serial Killer wins if SK alive and it is the last killer: no living Mafia,
  //    Triad, or Vampire (only SK + benign neutrals remain).
  if (skAlive && livingEvil.length === 0 && t.town.length === 0) {
    return { reason: 'serial_killer_last', winners: ['SERIAL_KILLER'] };
  }

  // 1. Town wins: no living Mafia, Triad, Vampire, or SK.
  if (livingEvil.length === 0 && !skAlive) {
    return { reason: 'town_elimination', winners: ['TOWN'] };
  }

  // 2. An evil killing faction wins ONLY when it is the SOLE killing faction left
  //    (no OTHER evil faction AND no SK) and it has reached parity with the rest.
  //    The evil factions are mutually exclusive winners — if two live, none wins.
  if (livingEvil.length === 1 && !skAlive) {
    const f = livingEvil[0]!;
    if (f.count >= living.length - f.count) {
      return { reason: f.reason, winners: [f.party] };
    }
  }

  // 4. 1v1 auto-resolve at start of DAY_VOTING: a deadlocked endgame neither side
  //    can mechanically break → priority SK > evil faction (Vampire>Triad>Mafia) > Town.
  if (opts.atDayVotingStart) {
    // SK + exactly one member of a single evil faction (no other evil, no Town):
    // SK wins (immune; can't be out-killed by a lone enemy).
    if (skAlive && livingEvil.length === 1 && livingEvil[0]!.count === 1 && t.town.length === 0) {
      return { reason: 'one_v_one', winners: ['SERIAL_KILLER'] };
    }
    // SK + exactly one Town (no evil faction at all): SK wins (town can't lynch alone).
    if (skAlive && t.town.length === 1 && livingEvil.length === 0) {
      return { reason: 'one_v_one', winners: ['SERIAL_KILLER'] };
    }
    // Pure evil-vs-evil endgame (two+ evil factions, no Town, no SK, no benign):
    // the LARGER killing faction wins; an exact tie at the top cannot be broken
    // (neither can out-kill the other without dying), so the game continues until
    // one side pulls ahead. Ties broken by the deterministic priority ladder.
    if (livingEvil.length >= 2 && !skAlive && t.town.length === 0 && t.benign.length === 0) {
      const ranked = [...livingEvil].sort((a, b) => b.count - a.count || b.priority - a.priority);
      const top = ranked[0]!;
      const second = ranked[1]!;
      // A strict lead at the top wins; an exact count tie continues.
      if (top.count > second.count) return { reason: 'one_v_one', winners: [top.party] };
      // tie → continue.
    }
    // (Evil-vs-Town parity already covered by rule 2.)
  }

  return null;
}

/**
 * Stalemate guard (§6.9.6): if `quietNights` reached the threshold, the game
 * ends — largest living faction wins. Priority ladder for ties: SK > Vampire >
 * Triad > Mafia > Town (SK counts as a faction of 1 and wins ties; among the evil
 * factions the larger wins, tie ⇒ the deterministic priority above).
 */
export function checkStalemate(
  state: GameState,
): { reason: WinCheckReason; winners: WinningParty[] } | null {
  if (state.quietNights < STALEMATE_QUIET_NIGHTS) return null;
  const t = tally(state);

  // Larger count wins; ties broken by priority (SK > Vampire > Triad > Mafia > Town).
  const candidates: { party: WinningParty; count: number; priority: number }[] = [];
  if (t.town.length > 0) candidates.push({ party: 'TOWN', count: t.town.length, priority: 0 });
  if (t.mafia.length > 0) candidates.push({ party: 'MAFIA', count: t.mafia.length, priority: 1 });
  if (t.triad.length > 0) candidates.push({ party: 'TRIAD', count: t.triad.length, priority: 2 });
  if (t.vampire.length > 0) candidates.push({ party: 'VAMPIRE', count: t.vampire.length, priority: 3 });
  if (t.sk.length > 0) candidates.push({ party: 'SERIAL_KILLER', count: t.sk.length, priority: 4 });

  if (candidates.length === 0) {
    return { reason: 'stalemate', winners: ['DRAW'] };
  }

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

  // Pirate (batch E) personal win: landed enough successful plunders AND alive at
  // the end. A personal rider like the Executioner — independent of who took the
  // match. Computed from the final state into pirateWinners (mirrors gaWinners).
  state.pirateWinners = [];
  for (const s of state.seats) {
    if (s.role === 'PIRATE' && s.alive && s.plunderCount >= PIRATE_PLUNDERS_TO_WIN) {
      state.pirateWinners.push(s.seat);
    }
  }
  if (state.pirateWinners.length > 0) winners.add('PIRATE');

  // Witch (batch E) SPOILER win: a living Witch wins iff the Town did NOT win
  // (she rides any evil / neutral-killing victory, or a non-Town stalemate, or any
  // end where the Town is not among the winners). Computed AFTER the base winners
  // are known, BEFORE the Witch rider is added (so the Witch does not count herself
  // as a non-Town winner). Recorded into witchWinners (mirrors gaWinners).
  state.witchWinners = [];
  const townWon = winners.has('TOWN');
  if (!townWon) {
    for (const s of state.seats) {
      if (s.role === 'WITCH' && s.alive) state.witchWinners.push(s.seat);
    }
  }
  if (state.witchWinners.length > 0) winners.add('WITCH');

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
  // Batch E personal riders: the Pirate (enough plunders, alive) and the Witch
  // (alive in a game the Town did not win) were computed into their winner lists
  // in buildGameOver.
  if (state.pirateWinners.includes(seat.seat)) return true;
  if (state.witchWinners.includes(seat.seat)) return true;
  // Survivor and a never-remembered Amnesiac ride any win if alive at the end.
  if (seat.role === 'SURVIVOR' || seat.role === 'AMNESIAC') return seat.alive;

  switch (seat.faction) {
    case 'TOWN':
      return winners.includes('TOWN');
    case 'MAFIA':
      return winners.includes('MAFIA');
    case 'TRIAD':
      return winners.includes('TRIAD');
    case 'VAMPIRE':
      return winners.includes('VAMPIRE');
    case 'NEUTRAL_KILLING':
      return winners.includes('SERIAL_KILLER');
    case 'NEUTRAL_BENIGN':
      // Jester/Exe handled above; a benign with no personal win loses.
      return false;
    default:
      return false;
  }
}
