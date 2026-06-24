/**
 * Notifications center store state machine against the NO_DB MemoryStore (QoL
 * wave). MemoryStore is guests-only, so these use synthetic user ids; the same
 * contract backs PgStore (covered by the schema + a live smoke test). Covers
 * create → list (newest-first), unread count, mark-read (by id + all), and the
 * read cap.
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';

const U = 'user-aaaaaaaa';
const V = 'user-bbbbbbbb';

describe('notifications store', () => {
  it('create → list newest-first, unread count', async () => {
    const store = new MemoryStore();
    await store.createNotification(U, 'friend_request', { fromId: V, fromUsername: 'Capone' });
    await store.createNotification(U, 'rank_up', { rank: 'fixer', rankName: 'Fixer', mmr: 1510 });
    await store.createNotification(U, 'achievement', { key: 'first_win', name: 'First Blood', points: 25 });

    const list = await store.listNotifications(U, 50);
    expect(list).toHaveLength(3);
    // Newest first: the last inserted comes first.
    expect(list.map((n) => n.type)).toEqual(['achievement', 'rank_up', 'friend_request']);
    // Payloads round-trip intact.
    expect(list[2]!.payload).toMatchObject({ fromUsername: 'Capone' });
    // All start unread.
    expect(list.every((n) => n.readAt === null)).toBe(true);
    expect(await store.getUnreadNotificationCount(U)).toBe(3);
  });

  it('a notification for one user is invisible to another', async () => {
    const store = new MemoryStore();
    await store.createNotification(U, 'mention', { byId: V, byUsername: 'Nitti' });
    expect(await store.listNotifications(V, 50)).toHaveLength(0);
    expect(await store.getUnreadNotificationCount(V)).toBe(0);
    expect(await store.getUnreadNotificationCount(U)).toBe(1);
  });

  it('markNotificationsRead by id marks only those, returning the new unread count', async () => {
    const store = new MemoryStore();
    await store.createNotification(U, 'friend_request', { fromUsername: 'A' });
    await store.createNotification(U, 'friend_request', { fromUsername: 'B' });
    await store.createNotification(U, 'friend_request', { fromUsername: 'C' });
    const list = await store.listNotifications(U, 50);
    expect(list).toHaveLength(3);

    const firstId = list[0]!.id;
    const unread = await store.markNotificationsRead(U, [firstId]);
    expect(unread).toBe(2);

    const after = await store.listNotifications(U, 50);
    expect(after.find((n) => n.id === firstId)!.readAt).not.toBeNull();
    expect(after.filter((n) => n.readAt === null)).toHaveLength(2);
  });

  it('markNotificationsRead with no ids marks ALL read', async () => {
    const store = new MemoryStore();
    await store.createNotification(U, 'rank_up', { rankName: 'Fixer' });
    await store.createNotification(U, 'achievement', { name: 'X', points: 10 });
    expect(await store.getUnreadNotificationCount(U)).toBe(2);

    const unread = await store.markNotificationsRead(U);
    expect(unread).toBe(0);
    expect(await store.getUnreadNotificationCount(U)).toBe(0);
    // A second mark-all is a harmless no-op.
    expect(await store.markNotificationsRead(U)).toBe(0);
  });

  it('an explicit empty id array marks nothing', async () => {
    const store = new MemoryStore();
    await store.createNotification(U, 'rank_up', { rankName: 'Fixer' });
    const unread = await store.markNotificationsRead(U, []);
    expect(unread).toBe(1);
  });

  it('list caps at 50 even when more exist', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) {
      await store.createNotification(U, 'friend_request', { fromUsername: `u${i}` });
    }
    const list = await store.listNotifications(U, 200);
    expect(list).toHaveLength(50);
    // Still newest-first: the most-recent insert (u59) leads.
    expect(list[0]!.payload['fromUsername']).toBe('u59');
    // The unread count reflects ALL of them, not just the page.
    expect(await store.getUnreadNotificationCount(U)).toBe(60);
  });
});
