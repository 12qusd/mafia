/**
 * Notifications center generation helpers (QoL wave).
 *
 * The in-app bell feed unifies friend-requests, accepts, @mentions (future),
 * rank-ups, and achievements. HTTP + its own table only — this NEVER touches the
 * engine, the game WS protocol, or the §5 leak path.
 *
 * INVARIANT: notification generation is BEST-EFFORT. Every helper here is
 * wrapped so a failed insert (or a non-persistent store) logs + returns instead
 * of throwing — a failed notification must never break the triggering action
 * (a friend request, match-end scoring, etc.). All helpers are account-only:
 * they no-op on a non-persistent store and for guest/bot ids (`guest:` prefix),
 * which have no user row.
 */

import type { NotificationType } from '@nocturne/shared';
import type { Store } from '../db/types.js';
import { log } from '../log.js';

/** Guests/bots use `guest:` identities — no account row, so no notifications. */
function isRealUser(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && !id.startsWith('guest:');
}

/**
 * Create a notification, swallowing+logging any failure. Persistent-only and
 * account-only (guests/bots are skipped). Returns nothing — callers never branch
 * on the outcome (best-effort by design).
 */
export async function notify(
  store: Store,
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!store.persistent) return;
  if (!isRealUser(userId)) return;
  try {
    await store.createNotification(userId, type, payload);
  } catch (err) {
    // Best-effort: a notification failure must never bubble into the caller.
    log.error('failed to create notification', { userId, type, err: String(err) });
  }
}
