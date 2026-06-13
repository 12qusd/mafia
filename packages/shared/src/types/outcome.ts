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
  'SERIAL_KILLER',
  'JESTER',
  'EXECUTIONER',
  'SURVIVOR',
  'DRAW',
] as const;

export const WinningPartySchema = z.enum(WINNING_PARTIES);
export type WinningParty = z.infer<typeof WinningPartySchema>;

/** Per-seat personal result, persisted in `match_players.outcome` (§10). */
export const SEAT_OUTCOMES = ['win', 'loss', 'draw', 'left'] as const;
export const SeatOutcomeSchema = z.enum(SEAT_OUTCOMES);
export type SeatOutcome = z.infer<typeof SeatOutcomeSchema>;
