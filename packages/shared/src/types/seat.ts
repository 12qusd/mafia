import { z } from 'zod';
import { RoleIdSchema } from './role.js';
import { FactionSchema } from './faction.js';

/**
 * Public, non-secret view of a seat (BUILD_SPEC §5 public state).
 *
 * `role`/`faction` are present only once the seat is legally revealed (death
 * with reveal, or game over). They are never populated for a living seat.
 */
export const PublicSeatSchema = z.object({
  seat: z.number().int().min(0),
  name: z.string(),
  alive: z.boolean(),
  connected: z.boolean(),
  afk: z.boolean(),
  /** Revealed role, if this seat has been legally revealed. */
  role: RoleIdSchema.optional(),
  /** Revealed faction, if this seat has been legally revealed. */
  faction: FactionSchema.optional(),
  /**
   * Whether this seat is a revealed Mayor (public knowledge: the mayor reveal is
   * a public `day_ability_ack`). A revealed Mayor's vote weighs 3, so the client
   * needs this to compute the correct weighted majority threshold. Leak-safe: the
   * reveal is already public and sets the seat's `revealed` flag.
   */
  mayorRevealed: z.boolean().optional(),
  /**
   * Whether this seat is an admin-created non-voting stump (vote weight 0). Public
   * (broadcast via `seat_transform`). Lets the client zero this seat's vote weight
   * in the threshold math.
   */
  stumped: z.boolean().optional(),
});
export type PublicSeat = z.infer<typeof PublicSeatSchema>;
