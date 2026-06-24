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

import { extractMentions, type NotificationType } from '@nocturne/shared';
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

/** Where a mention happened — shapes the bell text + link. */
export type MentionContext =
  | { context: 'forum'; threadId: string; postId?: string }
  | { context: 'room'; roomSlug: string; messageId?: string };

/** Max distinct @mentions resolved+notified per post/message (DoS + spam guard). */
const MAX_MENTIONS = 5;
/** A short, render-safe excerpt of the triggering text for the bell. */
const EXCERPT_MAX = 140;

/**
 * Best-effort @mention notifications for a freshly-created forum post or room
 * message. PARSES `body` (already length-capped + trimmed by zod) for up to
 * {@link MAX_MENTIONS} distinct `@username` tokens, resolves each against a REAL
 * account, and notifies them — UNLESS the target is the author themselves or has
 * blocked the author (mute relationship). Wrapped so a failure NEVER bubbles
 * into the triggering action; entirely inert on a non-persistent/guest store.
 *
 * INVARIANT: HTTP + the notifications table only. Never touches the engine, the
 * game WS protocol, or the §5 leak path.
 */
export async function notifyMentions(
  store: Store,
  author: { id: string; name: string },
  body: string,
  where: MentionContext,
): Promise<void> {
  // Account-only + parse-only: nothing to do under NO_DB / for guest authors.
  if (!store.persistent) return;
  if (!isRealUser(author.id)) return;
  try {
    const names = extractMentions(body, MAX_MENTIONS);
    if (names.length === 0) return;
    const excerpt = makeExcerpt(body);
    for (const name of names) {
      const target = await store.getUserByUsername(name);
      if (!target) continue; // unknown handle
      if (target.id === author.id) continue; // don't notify yourself
      // Block-aware: if the target has muted/blocked the author, stay silent.
      const targetBlocks = await store.getMutes(target.id);
      if (targetBlocks.includes(author.id)) continue;
      await notify(store, target.id, 'mention', {
        fromId: author.id,
        fromUsername: author.name,
        // The bell renders by `byUsername` for mention/friend links; provide both
        // keys so existing rendering and any future code resolves a clean name.
        byId: author.id,
        byUsername: author.name,
        excerpt,
        ...where,
      });
    }
  } catch (err) {
    // Best-effort: mention resolution/notification must never break the post.
    log.error('failed to process mentions', { authorId: author.id, err: String(err) });
  }
}

/** Collapse whitespace and clip to a short, render-safe snippet for the bell. */
function makeExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat;
}
