/**
 * Logical game clock (BUILD_SPEC §6).
 *
 * The engine is pure and never reads wall-clock time. A {@link GameTick} is an
 * injected monotonic timestamp (server epoch milliseconds, as a number) used
 * for phase deadlines. The server supplies it; the engine only compares and
 * stores it. Clients render countdowns from `phase_change.endsAt` corrected by
 * a measured client-server clock offset (§6.2).
 */
export type GameTick = number;
