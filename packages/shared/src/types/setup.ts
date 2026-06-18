import { z } from 'zod';
import { RoleIdSchema } from './role.js';

/**
 * Slot category pools (BUILD_SPEC §6.10).
 *
 * - RANDOM_TOWN  — any Town role drawn from the setup's allowlist.
 * - RANDOM_MAFIA — a non-unique Mafia support role (RANDOM_MAFIA_POOL).
 * - RANDOM_TRIAD — a non-unique Triad support role (RANDOM_TRIAD_POOL); the
 *                  Mafia mirror for the second evil faction.
 */
export const SLOT_CATEGORIES = ['RANDOM_TOWN', 'RANDOM_MAFIA', 'RANDOM_TRIAD'] as const;
export const SlotCategorySchema = z.enum(SLOT_CATEGORIES);
export type SlotCategory = z.infer<typeof SlotCategorySchema>;

/** A fixed-role slot: this exact role is assigned. */
export const FixedSlotSchema = z.object({
  kind: z.literal('fixed'),
  role: RoleIdSchema,
});
export type FixedSlot = z.infer<typeof FixedSlotSchema>;

/**
 * A category slot: a role is drawn from the named pool at match start using the
 * match PRNG, honoring unique-role constraints (Jailor, Mayor, Godfather once).
 */
export const CategorySlotSchema = z.object({
  kind: z.literal('category'),
  category: SlotCategorySchema,
});
export type CategorySlot = z.infer<typeof CategorySlotSchema>;

export const SetupSlotSchema = z.discriminatedUnion('kind', [FixedSlotSchema, CategorySlotSchema]);
export type SetupSlot = z.infer<typeof SetupSlotSchema>;

/**
 * A game setup (BUILD_SPEC §6.10): an ordered slot list plus the Town allowlist
 * that `RANDOM_TOWN` draws from. `minPlayers`/`maxPlayers` describe the player
 * counts this setup serves; an auto-scaling setup spans a range, a curated
 * setup pins a single count.
 */
export const GameSetupSchema = z.object({
  /** Stable identifier referenced by lobbies and persistence. */
  id: z.string(),
  /** Human-facing setup name. */
  name: z.string(),
  /** Short description for the lobby setup picker. */
  description: z.string(),
  minPlayers: z.number().int().min(1),
  maxPlayers: z.number().int().min(1),
  /** Town roles `RANDOM_TOWN` may draw from. */
  townPool: z.array(RoleIdSchema),
  /**
   * Slot lists keyed by player count. An auto-scaling setup has an entry per
   * supported count (7..15); a curated single-count setup has one entry.
   */
  slotsByPlayerCount: z.record(z.string(), z.array(SetupSlotSchema)),
});
export type GameSetup = z.infer<typeof GameSetupSchema>;
