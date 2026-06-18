/**
 * PURE setup validation (BUILD_SPEC §6.10).
 *
 * A malformed setup can crash the engine's `init()` (wrong slot count, a
 * nonexistent role id, a category pool that draws nothing). This validator MUST
 * run before any custom/generated setup is persisted or used to create a lobby.
 * It is pure (no I/O, no clock, no randomness) and returns human-readable error
 * strings in the same noir-plain register as the rest of `shared`.
 */

import type { GameSetup, SetupSlot, SlotCategory } from '../types/setup.js';
import type { RoleId } from '../types/role.js';
import type { Faction } from '../types/faction.js';
import { ROLES, ALL_ROLES, UNIQUE_ROLES, RANDOM_TRIAD_POOL } from '../roles/index.js';
import { slotFaction } from './compose.js';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ALL_ROLE_IDS = new Set<string>(ALL_ROLES.map((r) => r.id));

/** The faction a `RANDOM_*` category pool is required to be homogeneous in. */
const CATEGORY_FACTION: Record<SlotCategory, Faction> = {
  RANDOM_TOWN: 'TOWN',
  RANDOM_MAFIA: 'MAFIA',
  RANDOM_TRIAD: 'TRIAD',
};

/** Whether a slot guarantees a kill-capable role (so a game can actually end). */
function slotIsKilling(slot: SetupSlot, townPool: readonly RoleId[]): boolean {
  if (slot.kind === 'fixed') {
    if (!ALL_ROLE_IDS.has(slot.role)) return false; // unknown role: not a kill source.
    // Any MAFIA or TRIAD slot carries a standing faction kill; a VAMPIRE slot
    // carries a standing CONVERSION that drives the game to a parity win (it
    // grows the coven until it ends the game, so the game can always reach a
    // terminal state); an explicit `kill` role (Vigilante / Mafioso / Enforcer /
    // Serial Killer / jailed execution) also qualifies.
    const f = slotFaction(slot);
    return f === 'MAFIA' || f === 'TRIAD' || f === 'VAMPIRE' || ROLES[slot.role].nightAction === 'kill';
  }
  // RANDOM_MAFIA / RANDOM_TRIAD carry a standing faction kill.
  if (slot.category === 'RANDOM_MAFIA' || slot.category === 'RANDOM_TRIAD') return true;
  // RANDOM_TOWN: killing iff the pool can draw a kill-capable Town role.
  return townPool.some((r) => ALL_ROLE_IDS.has(r) && ROLES[r].nightAction === 'kill');
}

/**
 * Validate a setup. If `playerCount` is supplied, the setup is also checked for
 * the ability to host exactly that count (range + a matching slots entry).
 */
export function validateSetup(setup: GameSetup, playerCount?: number): ValidationResult {
  const errors: string[] = [];

  // --- Player-count bounds --------------------------------------------------
  if (setup.minPlayers > setup.maxPlayers) {
    errors.push(
      `minPlayers (${setup.minPlayers}) exceeds maxPlayers (${setup.maxPlayers}).`,
    );
  }

  // --- townPool references real roles --------------------------------------
  for (const roleId of setup.townPool) {
    if (!ALL_ROLE_IDS.has(roleId)) {
      errors.push(`townPool references unknown role "${roleId}".`);
    }
  }

  const countKeys = Object.keys(setup.slotsByPlayerCount);
  if (countKeys.length === 0) {
    errors.push('Setup has no player-count entries.');
  }

  // --- Per-count checks -----------------------------------------------------
  for (const key of countKeys) {
    const slots = setup.slotsByPlayerCount[key] ?? [];
    const count = Number(key);
    const where = `at ${key} players`;

    if (!Number.isInteger(count) || count <= 0) {
      errors.push(`Player-count key "${key}" is not a positive integer.`);
    } else if (slots.length !== count) {
      errors.push(
        `${where}: slot count ${slots.length} does not equal the player count ${count}.`,
      );
    }

    // Every fixed slot must reference a real role.
    for (const slot of slots) {
      if (slot.kind === 'fixed' && !ALL_ROLE_IDS.has(slot.role)) {
        errors.push(`${where}: unknown role "${slot.role}" in a fixed slot.`);
      }
      if (slot.kind === 'category' && !(slot.category in CATEGORY_FACTION)) {
        errors.push(`${where}: unknown category "${slot.category}".`);
      }
    }

    // Unique roles appear at most once (fixed slots only; a category draw never
    // double-assigns a unique role, the engine enforces that at draw time).
    for (const unique of UNIQUE_ROLES) {
      const n = slots.filter((s) => s.kind === 'fixed' && s.role === unique).length;
      if (n > 1) {
        errors.push(`${where}: unique role "${unique}" appears ${n} times (max 1).`);
      }
    }

    // At least one killing role so the game can reach a win condition.
    if (slots.length > 0 && !slots.some((s) => slotIsKilling(s, setup.townPool))) {
      errors.push(`${where}: no killing role — the game could never end.`);
    }
  }

  // --- Category pool soundness (faction-homogeneous, non-empty, real) -------
  // RANDOM_TOWN draws from `townPool`; RANDOM_MAFIA from the fixed mafia pool.
  const usedCategories = new Set<SlotCategory>();
  for (const slots of Object.values(setup.slotsByPlayerCount)) {
    for (const slot of slots) {
      if (slot.kind === 'category') usedCategories.add(slot.category);
    }
  }
  if (usedCategories.has('RANDOM_TOWN')) {
    const townRoles = setup.townPool.filter((r) => ALL_ROLE_IDS.has(r));
    if (townRoles.length === 0) {
      errors.push('RANDOM_TOWN is used but the townPool is empty.');
    }
    for (const roleId of townRoles) {
      if (ROLES[roleId].faction !== 'TOWN') {
        errors.push(`RANDOM_TOWN pool contains non-Town role "${roleId}".`);
      }
    }
  }
  // RANDOM_TRIAD draws from the fixed RANDOM_TRIAD_POOL; assert it is non-empty
  // and Triad-homogeneous (defence in depth — the pool is a static constant).
  if (usedCategories.has('RANDOM_TRIAD')) {
    if (RANDOM_TRIAD_POOL.length === 0) {
      errors.push('RANDOM_TRIAD is used but the Triad support pool is empty.');
    }
    for (const roleId of RANDOM_TRIAD_POOL) {
      if (!ALL_ROLE_IDS.has(roleId) || ROLES[roleId].faction !== 'TRIAD') {
        errors.push(`RANDOM_TRIAD pool contains non-Triad role "${roleId}".`);
      }
    }
  }

  // --- Optional exact-count check ------------------------------------------
  if (playerCount !== undefined) {
    if (playerCount < setup.minPlayers || playerCount > setup.maxPlayers) {
      errors.push(
        `${playerCount} players is outside this setup's range ` +
          `(${setup.minPlayers}–${setup.maxPlayers}).`,
      );
    }
    if (setup.slotsByPlayerCount[String(playerCount)] === undefined) {
      errors.push(`Setup has no slot list for ${playerCount} players.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
