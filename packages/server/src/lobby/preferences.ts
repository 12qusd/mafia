/**
 * Server-side role-preference gating (goal 3).
 *
 * Role preferences are point-unlocked: a player may BLACKLIST roles only once
 * their lifetime points reach `UNLOCKS.ROLE_BLACKLIST_AT`, and PREFER roles only
 * at `UNLOCKS.ROLE_PREFER_AT`. The gate is enforced HERE, server-side, against
 * the player's persisted `user_stats.total_points` — never trusting the client.
 * A player whose stored prefs are stale (e.g. set when they had more points, or
 * a tampered client) has the un-entitled entries dropped before they ever reach
 * the engine's seat-assignment.
 *
 * Only registered accounts have preferences; guests (`guest:` ids) and bots have
 * none. The result feeds {@link Connection.seatPreference} so the synchronous
 * start path can read it without an await.
 */

import { unlocksFor } from '@nocturne/shared';
import type { Store } from '../db/index.js';

export interface GatedSeatPreference {
  blacklist: string[];
  prefer: string[];
}

/** Registered accounts have a bare uuid id; guests are `guest:<uuid>`. */
function isRegistered(identityId: string): boolean {
  return !identityId.startsWith('guest:');
}

/**
 * Fetch and UNLOCK-GATE a registered player's role preferences. Returns `null`
 * for guests/bots, players below the blacklist threshold with no preferred
 * roles, or accounts with no stored prefs. Otherwise returns the gated lists
 * (entries the player has not unlocked are dropped). Pure read; no mutation.
 */
export async function fetchGatedSeatPreference(
  store: Store,
  identityId: string,
): Promise<GatedSeatPreference | null> {
  if (!store.persistent || !isRegistered(identityId)) return null;

  const [prefs, stats] = await Promise.all([
    store.getRolePreferences(identityId),
    store.getUserStats(identityId),
  ]);
  if (prefs.length === 0) return null;

  const totalPoints = stats?.totalPoints ?? 0;
  const { canBlacklistRoles, canPreferRoles } = unlocksFor(totalPoints);

  const blacklist: string[] = [];
  const prefer: string[] = [];
  for (const p of prefs) {
    if (p.preference === 'blacklist' && canBlacklistRoles) blacklist.push(p.role);
    else if (p.preference === 'prefer' && canPreferRoles) prefer.push(p.role);
  }
  if (blacklist.length === 0 && prefer.length === 0) return null;
  return { blacklist, prefer };
}
