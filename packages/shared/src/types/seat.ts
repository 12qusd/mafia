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
});
export type PublicSeat = z.infer<typeof PublicSeatSchema>;
