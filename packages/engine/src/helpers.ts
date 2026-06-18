/**
 * Pure state-access and effect-construction helpers.
 *
 * Effects ({@link Effect}) are the engine's only output channel besides the new
 * state. All §5 entitlement addressing is decided here and in the effect
 * builders below — the server delivers effects verbatim.
 */

import {
  PROTOCOL_VERSION,
  type SeatId,
  type Faction,
  type RoleId,
  type Effect,
  type ServerMessage,
  type Phase,
  type GameTick,
} from '@nocturne/shared';
import type { GameState, SeatState } from './state.js';

// --- Seat lookups ----------------------------------------------------------

export function seatOf(state: GameState, seat: SeatId): SeatState {
  const s = state.seats[seat];
  if (!s) throw new Error(`engine: unknown seat ${seat}`);
  return s;
}

export function livingSeats(state: GameState): SeatState[] {
  return state.seats.filter((s) => s.alive);
}

export function isMafiaFaction(faction: Faction): boolean {
  return faction === 'MAFIA';
}

export function livingMafiaSeats(state: GameState): SeatState[] {
  return state.seats.filter((s) => s.alive && s.faction === 'MAFIA');
}

/** Seat vote weight (Mayor 3 after reveal, else 1; a stump cannot vote → 0). */
export function voteWeight(seat: SeatState): number {
  if (seat.stumped) return 0;
  return seat.mayorRevealed ? 3 : 1;
}

/** Total living vote weight (for nomination/skip majority math). */
export function livingVoteWeight(state: GameState): number {
  return livingSeats(state).reduce((sum, s) => sum + voteWeight(s), 0);
}

/** Nomination/skip majority threshold: floor(livingVoteWeight/2)+1. */
export function majorityThreshold(state: GameState): number {
  return Math.floor(livingVoteWeight(state) / 2) + 1;
}

// --- Immutability helpers --------------------------------------------------

/**
 * Deep clone of game state. State is plain JSON data, so structuredClone is
 * exact and keeps the engine pure (no shared mutable references leak out).
 */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

// --- Effect builders -------------------------------------------------------

/**
 * Distributive "omit the envelope version" over the server-message union, so
 * each builder accepts a single concrete message payload (its `type` literal
 * keeps the union member resolvable) without `v`.
 */
type ServerMessagePayload = ServerMessage extends infer M
  ? M extends { v: unknown }
    ? Omit<M, 'v'>
    : never
  : never;

function msg(payload: ServerMessagePayload): ServerMessage {
  return { v: PROTOCOL_VERSION, ...payload } as ServerMessage;
}

export function toPublic(payload: ServerMessagePayload): Effect {
  return { to: 'public', msg: msg(payload) };
}

export function toMafia(payload: ServerMessagePayload): Effect {
  return { to: 'mafia', msg: msg(payload) };
}

export function toDead(payload: ServerMessagePayload): Effect {
  return { to: 'dead', msg: msg(payload) };
}

export function toSeats(seats: SeatId[], payload: ServerMessagePayload): Effect {
  return { to: seats.slice(), msg: msg(payload) };
}

export function toSeat(seat: SeatId, payload: ServerMessagePayload): Effect {
  return { to: [seat], msg: msg(payload) };
}

// --- Phase-change effect ---------------------------------------------------

export function phaseChangeEffect(phase: Phase, dayNumber: number, endsAt: GameTick | null): Effect {
  return toPublic({ type: 'phase_change', phase, dayNumber, endsAt });
}

// --- Role / faction reveal helpers -----------------------------------------

export function reveal(seat: SeatState): { role: RoleId; faction: Faction } {
  return { role: seat.role, faction: seat.faction };
}
