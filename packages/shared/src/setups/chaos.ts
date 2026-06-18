/**
 * PURE deterministic "chaos" setup generator.
 *
 * Builds a wild-but-legal setup entirely from a seed string — no clock, no
 * `Math.random`. Same `(seed, playerCount)` ⇒ byte-identical setup. The output
 * always passes {@link validateSetup}: a guaranteed Mafia core (Godfather + a
 * scaling Mafia), a lurking neutral killer at larger tables, and the rest a
 * grab-bag of Town, with unique roles never doubled.
 *
 * Two modes:
 *  - `chaosSetup(seed)`        → a multi-count setup spanning 7..15 (behaves like
 *                                a shipped auto-scaling setup; used by lobbies).
 *  - `chaosSetup(seed, count)` → a single-count setup pinned to `count`.
 */

import type { GameSetup, SetupSlot } from '../types/setup.js';
import type { RoleId } from '../types/role.js';
import { ROLES, UNIQUE_ROLES } from '../roles/index.js';
import { seedPrng, shuffle, type PrngState } from './prng.js';

/** Span of player counts a multi-count chaos setup serves. */
const CHAOS_MIN = 7;
const CHAOS_MAX = 15;

const UNIQUE = new Set<RoleId>(UNIQUE_ROLES);

/** Every Town role, used as the chaos Town draw pool. */
const TOWN_ROLES: readonly RoleId[] = (Object.keys(ROLES) as RoleId[]).filter(
  (id) => ROLES[id].faction === 'TOWN',
);

/** Non-unique Mafia support roles a chaos Mafia can stack. */
const MAFIA_SUPPORT: readonly RoleId[] = (Object.keys(ROLES) as RoleId[]).filter(
  (id) => ROLES[id].faction === 'MAFIA' && !ROLES[id].unique && id !== 'MAFIOSO',
);

const F = (role: RoleId): SetupSlot => ({ kind: 'fixed', role });

/** Mafia headcount for a table size — mirrors Classic's 2→3 scaling. */
function mafiaCount(playerCount: number): number {
  return playerCount >= 12 ? 3 : 2;
}

/** Neutral-killer headcount — a Serial Killer joins from 10 players up. */
function neutralKillerCount(playerCount: number): number {
  return playerCount >= 10 ? 1 : 0;
}

/**
 * Draw the slot list for a single player count from a per-count derived seed.
 * Deterministic: the seed fully determines the Town draw and Mafia support pick.
 */
function chaosSlots(seed: string, playerCount: number): SetupSlot[] {
  let prng: PrngState = seedPrng(`${seed}:chaos:${playerCount}`);
  const slots: SetupSlot[] = [];

  // --- Mafia core: Godfather + Mafioso, then scaling support ---------------
  slots.push(F('GODFATHER'));
  slots.push(F('MAFIOSO'));
  const totalMafia = mafiaCount(playerCount);
  let extraMafia = Math.max(0, totalMafia - 2);
  // Stack a random non-unique Mafia support role (Consort/Framer) per extra.
  {
    const sh = shuffle(prng, MAFIA_SUPPORT);
    prng = sh.state;
    for (let i = 0; i < extraMafia && i < sh.value.length; i++) {
      slots.push(F(sh.value[i] as RoleId));
      extraMafia--;
    }
    // If we somehow ran out of distinct support roles, fall back to a category.
    for (let i = 0; i < extraMafia; i++) slots.push({ kind: 'category', category: 'RANDOM_MAFIA' });
  }

  // --- Neutral killer (Serial Killer) at larger tables ----------------------
  const nk = neutralKillerCount(playerCount);
  for (let i = 0; i < nk; i++) slots.push(F('SERIAL_KILLER'));

  // --- The rest: random Town, unique roles at most once --------------------
  const remaining = playerCount - slots.length;
  const shuffled = shuffle(prng, TOWN_ROLES);
  prng = shuffled.state;
  const usedUnique = new Set<RoleId>();
  let filled = 0;
  for (const role of shuffled.value) {
    if (filled >= remaining) break;
    if (UNIQUE.has(role)) {
      if (usedUnique.has(role)) continue;
      usedUnique.add(role);
    }
    slots.push(F(role));
    filled++;
  }
  // If the unique-role filtering left gaps (small Town pool), pad with the
  // always-available non-unique Citizen so the slot count matches exactly.
  while (filled < remaining) {
    slots.push(F('CITIZEN'));
    filled++;
  }

  return slots;
}

const CHAOS_NAME = 'Anything Goes';
const CHAOS_DESCRIPTION =
  'The house deals a stacked deck tonight. A Mafia you can count on, a knife in the dark, ' +
  'and a Town drawn blind from the whole roster — nobody at this table knows what they are ' +
  'walking into.';

/**
 * Generate a deterministic chaos setup. With `playerCount` omitted the setup
 * spans 7..15 (auto-scaling, like a shipped setup); with it, the setup is pinned
 * to that single count. The id is `chaos:<seed>` either way.
 */
export function chaosSetup(seed: string, playerCount?: number): GameSetup {
  const slotsByPlayerCount: Record<string, SetupSlot[]> = {};
  if (playerCount !== undefined) {
    slotsByPlayerCount[String(playerCount)] = chaosSlots(seed, playerCount);
    return {
      id: `chaos:${seed}`,
      name: CHAOS_NAME,
      description: CHAOS_DESCRIPTION,
      minPlayers: playerCount,
      maxPlayers: playerCount,
      townPool: [...TOWN_ROLES],
      slotsByPlayerCount,
    };
  }
  for (let n = CHAOS_MIN; n <= CHAOS_MAX; n++) {
    slotsByPlayerCount[String(n)] = chaosSlots(seed, n);
  }
  return {
    id: `chaos:${seed}`,
    name: CHAOS_NAME,
    description: CHAOS_DESCRIPTION,
    minPlayers: CHAOS_MIN,
    maxPlayers: CHAOS_MAX,
    townPool: [...TOWN_ROLES],
    slotsByPlayerCount,
  };
}
