/**
 * Core identifier types.
 *
 * A {@link SeatId} is the in-game position index of a player within a single
 * match. Seats are 0-based and stable for the life of a match. Seat identity is
 * what the engine and protocol reason about; account/guest identity is a
 * server-side concern that maps onto a seat (BUILD_SPEC §8).
 */

/** In-game seat index (0-based, stable for the match). */
export type SeatId = number;

/** Opaque lobby identifier (server-assigned). */
export type LobbyId = string;

/** Opaque match identifier (server-assigned, persisted). */
export type MatchId = string;

/** Account or guest identity id (server-side; opaque to the engine). */
export type UserOrGuestId = string;
