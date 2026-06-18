import type { SeatId } from './ids.js';

/**
 * Effect addressing (BUILD_SPEC §5, §6).
 *
 * An {@link EffectTarget} names the audience for an outbound server message.
 * All entitlement logic lives in the engine, which emits effects; the server
 * transport delivers them verbatim. There is intentionally no `'spectator'`
 * target distinct from `'public'`: spectators receive exactly the public
 * stream and never any secret, regardless of `deadSeeAll` (§7.8).
 *
 * - `'public'`      — every connected client, including spectators.
 * - `'dead'`        — dead seats (dead chat; full info only if `deadSeeAll`).
 * - `'mafia'`       — living mafia-member seats.
 * - `'triad'`       — living triad-member seats (the Mafia mirror for the second
 *                     evil faction; never routed to mafia/town/neutrals/dead/spec).
 * - `SeatId[]`      — an explicit, individually addressed set of seats
 *                     (your_role, private_result, whisper, jail chat, …).
 */
export type EffectTarget = 'public' | 'dead' | 'mafia' | 'triad' | SeatId[];

/**
 * An addressed outbound message. Generic over the message payload so this core
 * type carries no dependency on the protocol module; the protocol module
 * re-exports a concrete `Effect` bound to `ServerMessage`.
 */
export interface AddressedEffect<TMsg> {
  to: EffectTarget;
  msg: TMsg;
}
