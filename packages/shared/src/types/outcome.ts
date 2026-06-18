import { z } from 'zod';

/**
 * Win outcomes (BUILD_SPEC §6.9).
 *
 * `winningParties` enumerates which collective(s) won the match. Multiple
 * parties can appear because riders (Survivor, Jester, Executioner) win
 * personally alongside the faction outcome.
 */
export const WINNING_PARTIES = [
  'TOWN',
  'MAFIA',
  'TRIAD',
  'SERIAL_KILLER',
  'JESTER',
  'EXECUTIONER',
  'SURVIVOR',
  // Guardian Angel (batch D) personal win: their assigned charge survived to the
  // end. A rider alongside the faction outcome, like JESTER / EXECUTIONER.
  'GUARDIAN_ANGEL',
  // --- Role-expansion batch E (complex neutrals) ---
  // Witch SPOILER win: the Witch is alive at game end and the Town did NOT win —
  // she rides any evil/neutral-killing victory (or a non-Town stalemate). A rider
  // alongside the faction outcome, like the Guardian Angel.
  'WITCH',
  // Pirate personal win: landed enough successful plunders AND is alive at the
  // end. A personal rider like the Executioner — independent of who took the match.
  'PIRATE',
  'DRAW',
] as const;

export const WinningPartySchema = z.enum(WINNING_PARTIES);
export type WinningParty = z.infer<typeof WinningPartySchema>;

/** Per-seat personal result, persisted in `match_players.outcome` (§10). */
export const SEAT_OUTCOMES = ['win', 'loss', 'draw', 'left'] as const;
export const SeatOutcomeSchema = z.enum(SEAT_OUTCOMES);
export type SeatOutcome = z.infer<typeof SeatOutcomeSchema>;
