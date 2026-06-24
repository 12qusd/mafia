/**
 * @mention notification hook (QoL "social rendering" wave).
 *
 * `notifyMentions` parses already-sanitized body text for @usernames, resolves
 * them to REAL accounts, and fires a best-effort `mention` notification —
 * skipping unknown handles, the author themselves, and anyone who has blocked
 * the author. These tests use a tiny fake Store so we can drive a PERSISTENT
 * (account-bearing) path that the guests-only MemoryStore cannot, and assert
 * exactly who would be notified. They also confirm the hook is best-effort:
 * inert under a non-persistent store and non-throwing on a failing insert.
 */

import { describe, it, expect } from 'vitest';
import { notifyMentions } from '../notifications/notify.js';
import type { Store, UserRow, NotificationRow } from '../db/types.js';

interface Created {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * A minimal Store stub exposing only what `notifyMentions` touches. Everything
 * else throws so an accidental call is loud. Cast to Store for the call site.
 */
function fakeStore(opts: {
  persistent?: boolean;
  users?: Record<string, string>; // username(lowercased) → userId
  blocks?: Record<string, string[]>; // userId → [blocked author ids]
  throwOnCreate?: boolean;
}): { store: Store; created: Created[] } {
  const created: Created[] = [];
  const usersByName = new Map<string, string>(
    Object.entries(opts.users ?? {}).map(([name, id]) => [name.toLowerCase(), id]),
  );
  const blocks = opts.blocks ?? {};
  const store = {
    persistent: opts.persistent ?? true,
    async getUserByUsername(username: string): Promise<UserRow | null> {
      const id = usersByName.get(username.toLowerCase());
      if (!id) return null;
      return { id, username, email: null, passwordHash: '', flags: 0 };
    },
    async getMutes(muterId: string): Promise<string[]> {
      return blocks[muterId] ?? [];
    },
    async createNotification(
      userId: string,
      type: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      if (opts.throwOnCreate) throw new Error('boom');
      created.push({ userId, type, payload });
    },
    async listNotifications(): Promise<NotificationRow[]> {
      return [];
    },
  } as unknown as Store;
  return { store, created };
}

const AUTHOR = { id: 'author-1', name: 'Capone' };

describe('notifyMentions — resolve + notify real accounts only', () => {
  it('notifies a mentioned, existing account with the expected payload', async () => {
    const { store, created } = fakeStore({ users: { torrio: 'user-torrio' } });
    await notifyMentions(store, AUTHOR, 'good point @torrio — agreed', {
      context: 'forum',
      threadId: 'thread-1',
      postId: 'post-1',
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.userId).toBe('user-torrio');
    expect(created[0]!.type).toBe('mention');
    expect(created[0]!.payload).toMatchObject({
      fromId: 'author-1',
      fromUsername: 'Capone',
      byUsername: 'Capone',
      context: 'forum',
      threadId: 'thread-1',
      postId: 'post-1',
    });
    expect(typeof created[0]!.payload['excerpt']).toBe('string');
  });

  it('skips unknown handles', async () => {
    const { store, created } = fakeStore({ users: { real: 'user-real' } });
    await notifyMentions(store, AUTHOR, 'hi @ghost and @real', {
      context: 'room',
      roomSlug: 'shoutbox',
      messageId: 'm1',
    });
    expect(created.map((c) => c.userId)).toEqual(['user-real']);
  });

  it('does not notify the author about a self-mention', async () => {
    const { store, created } = fakeStore({ users: { capone: 'author-1' } });
    await notifyMentions(store, AUTHOR, 'as @capone i say', {
      context: 'forum',
      threadId: 't',
    });
    expect(created).toEqual([]);
  });

  it('is block-aware: a target who blocked the author is not notified', async () => {
    const { store, created } = fakeStore({
      users: { nitti: 'user-nitti' },
      blocks: { 'user-nitti': ['author-1'] },
    });
    await notifyMentions(store, AUTHOR, 'oi @nitti', { context: 'forum', threadId: 't' });
    expect(created).toEqual([]);
  });

  it('caps at 5 distinct mentions and de-dupes', async () => {
    // 6 distinct handles + a repeat of @aaa; the charset needs ≥3 chars.
    const { store, created } = fakeStore({
      users: { aaa: 'u-a', bbb: 'u-b', ccc: 'u-c', ddd: 'u-d', eee: 'u-e', fff: 'u-f' },
    });
    await notifyMentions(store, AUTHOR, '@aaa @bbb @ccc @aaa @ddd @eee @fff', {
      context: 'forum',
      threadId: 't',
    });
    // Only the first 5 distinct are resolved/notified.
    expect(created).toHaveLength(5);
    expect(created.map((c) => c.userId)).toEqual(['u-a', 'u-b', 'u-c', 'u-d', 'u-e']);
  });

  it('is inert under a non-persistent store (NO_DB)', async () => {
    const { store, created } = fakeStore({ persistent: false, users: { torrio: 'user-torrio' } });
    await notifyMentions(store, AUTHOR, 'hey @torrio', { context: 'forum', threadId: 't' });
    expect(created).toEqual([]);
  });

  it('is inert for a guest author (no account row)', async () => {
    const { store, created } = fakeStore({ users: { torrio: 'user-torrio' } });
    await notifyMentions(store, { id: 'guest:abc', name: 'Shade' }, 'yo @torrio', {
      context: 'forum',
      threadId: 't',
    });
    expect(created).toEqual([]);
  });

  it('does nothing when there are no mentions', async () => {
    const { store, created } = fakeStore({ users: { torrio: 'user-torrio' } });
    await notifyMentions(store, AUTHOR, 'just words, an email a@b', {
      context: 'forum',
      threadId: 't',
    });
    expect(created).toEqual([]);
  });

  it('never throws even if the underlying insert fails (best-effort)', async () => {
    const { store } = fakeStore({ users: { torrio: 'user-torrio' }, throwOnCreate: true });
    await expect(
      notifyMentions(store, AUTHOR, 'ping @torrio', { context: 'forum', threadId: 't' }),
    ).resolves.toBeUndefined();
  });
});
