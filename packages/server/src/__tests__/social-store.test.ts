/**
 * Social store state machines + reads against the NO_DB MemoryStore (Social
 * feature). MemoryStore is guests-only, so account-gated route happy-paths are
 * covered here at the store level with synthetic user ids; the route file is
 * exercised separately (social-routes.test.ts) for the guest/anon 403/404 path.
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';

const A = 'user-aaaaaaaa';
const B = 'user-bbbbbbbb';
const C = 'user-cccccccc';

describe('friendship state machine', () => {
  it('request → reverse-request accepts → both list each other → status → remove', async () => {
    const store = new MemoryStore();

    // A requests B.
    expect(await store.requestFriend(A, B)).toBe('created');
    // A requesting again (same direction) → exists.
    expect(await store.requestFriend(A, B)).toBe('exists');
    expect(await store.friendshipStatus(A, B)).toBe('pending_out');
    expect(await store.friendshipStatus(B, A)).toBe('pending_in');
    // Neither lists the other as a friend while pending.
    expect(await store.listFriends(A)).toHaveLength(0);
    expect(await store.listFriends(B)).toHaveLength(0);

    // B requests A → accepts the reverse pending row.
    expect(await store.requestFriend(B, A)).toBe('accepted');
    expect(await store.friendshipStatus(A, B)).toBe('friends');
    expect(await store.friendshipStatus(B, A)).toBe('friends');

    const aFriends = await store.listFriends(A);
    const bFriends = await store.listFriends(B);
    expect(aFriends.map((f) => f.userId)).toEqual([B]);
    expect(bFriends.map((f) => f.userId)).toEqual([A]);

    // Remove from either side dissolves the pair.
    expect(await store.removeFriend(B, A)).toBe(true);
    expect(await store.friendshipStatus(A, B)).toBe('none');
    expect(await store.listFriends(A)).toHaveLength(0);
    // Removing a non-existent pair returns false.
    expect(await store.removeFriend(A, C)).toBe(false);
  });

  it('respondFriend: only the addressee may act; accept vs decline', async () => {
    const store = new MemoryStore();
    await store.requestFriend(A, B);
    const reqs = await store.listFriendRequests(B);
    expect(reqs.incoming).toHaveLength(1);
    const fid = reqs.incoming[0]!.id;

    // The requester cannot respond to their own outgoing request.
    expect(await store.respondFriend(A, fid, true)).toBe(false);
    // The addressee accepts.
    expect(await store.respondFriend(B, fid, true)).toBe(true);
    expect(await store.friendshipStatus(A, B)).toBe('friends');

    // A second decline of an already-resolved request is a no-op.
    expect(await store.respondFriend(B, fid, false)).toBe(false);
  });

  it('respondFriend decline deletes the pending row', async () => {
    const store = new MemoryStore();
    await store.requestFriend(A, B);
    const fid = (await store.listFriendRequests(B)).incoming[0]!.id;
    expect(await store.respondFriend(B, fid, false)).toBe(true);
    expect(await store.friendshipStatus(A, B)).toBe('none');
    expect((await store.listFriendRequests(B)).incoming).toHaveLength(0);
    expect((await store.listFriendRequests(A)).outgoing).toHaveLength(0);
  });

  it('lists incoming and outgoing pending requests', async () => {
    const store = new MemoryStore();
    await store.requestFriend(A, B); // A→B
    await store.requestFriend(C, A); // C→A
    const aReqs = await store.listFriendRequests(A);
    expect(aReqs.outgoing.map((r) => r.userId)).toEqual([B]);
    expect(aReqs.incoming.map((r) => r.userId)).toEqual([C]);
  });
});

describe('rooms: seed + post + sinceId delta', () => {
  it('seeds the default rooms (ordered by sort) including the shoutbox', async () => {
    const store = new MemoryStore();
    const rooms = await store.listRooms();
    expect(rooms.map((r) => r.slug)).toEqual(['shoutbox', 'parlor', 'strategy', 'offtopic']);
    expect(rooms[0]!.kind).toBe('shoutbox');
    expect(rooms[1]!.kind).toBe('channel');
    const bySlug = await store.getRoomBySlug('parlor');
    expect(bySlug?.name).toBe('The Parlor');
    expect(await store.getRoomBySlug('nope')).toBeNull();
  });

  it('post + listRoomMessages returns ascending, honors limit + sinceId', async () => {
    const store = new MemoryStore();
    const room = (await store.getRoomBySlug('parlor'))!;
    const m1 = await store.postRoomMessage(room.id, A, 'first');
    const m2 = await store.postRoomMessage(room.id, B, 'second');
    const m3 = await store.postRoomMessage(room.id, A, 'third');

    const all = await store.listRoomMessages(room.id, { limit: 10 });
    expect(all.map((m) => m.body)).toEqual(['first', 'second', 'third']);

    // Limit returns the newest N, still ascending.
    const last2 = await store.listRoomMessages(room.id, { limit: 2 });
    expect(last2.map((m) => m.id)).toEqual([m2.id, m3.id]);

    // sinceId returns only strictly-newer messages.
    const delta = await store.listRoomMessages(room.id, { limit: 10, sinceId: m1.id });
    expect(delta.map((m) => m.id)).toEqual([m2.id, m3.id]);
    const none = await store.listRoomMessages(room.id, { limit: 10, sinceId: m3.id });
    expect(none).toHaveLength(0);
  });
});

describe('rooms: moderation (setRoomModeration)', () => {
  it('seeded rooms default to unlocked + slow-mode off', async () => {
    const store = new MemoryStore();
    const room = (await store.getRoomBySlug('parlor'))!;
    expect(room.locked).toBe(false);
    expect(room.slowModeSec).toBe(0);
    const fromList = (await store.listRooms()).find((r) => r.slug === 'parlor')!;
    expect(fromList.locked).toBe(false);
    expect(fromList.slowModeSec).toBe(0);
  });

  it('round-trips lock + slow-mode, leaves omitted fields unchanged, 404s an unknown slug', async () => {
    const store = new MemoryStore();
    // Set both flags.
    expect(await store.setRoomModeration('parlor', { locked: true, slowModeSec: 15 })).toBe(true);
    let room = (await store.getRoomBySlug('parlor'))!;
    expect(room.locked).toBe(true);
    expect(room.slowModeSec).toBe(15);

    // An update of only `locked` leaves slowModeSec untouched.
    expect(await store.setRoomModeration('parlor', { locked: false })).toBe(true);
    room = (await store.getRoomBySlug('parlor'))!;
    expect(room.locked).toBe(false);
    expect(room.slowModeSec).toBe(15);

    // listRooms surfaces the same moderation state.
    const fromList = (await store.listRooms()).find((r) => r.slug === 'parlor')!;
    expect(fromList.locked).toBe(false);
    expect(fromList.slowModeSec).toBe(15);

    // An unknown slug returns false.
    expect(await store.setRoomModeration('no-such-room', { locked: true })).toBe(false);
  });
});

describe('retention: pruneOldNotifications / pruneOldChat (MemoryStore)', () => {
  it('prunes only READ notifications older than the cutoff; keeps unread + recent', async () => {
    const store = new MemoryStore();
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const old = now - 40 * 24 * 60 * 60 * 1000;
    const recent = now - 1 * 24 * 60 * 60 * 1000;

    // Old + READ → pruned.
    store.seedNotificationForTest(A, 'rank_up', old, old);
    // Old but UNREAD → kept (unread rows survive regardless of age).
    store.seedNotificationForTest(A, 'rank_up', old, null);
    // Recent + READ → kept (within the window).
    store.seedNotificationForTest(A, 'rank_up', recent, recent);

    const deleted = await store.pruneOldNotifications(THIRTY_DAYS);
    expect(deleted).toBe(1);

    // Two notifications remain for A: the old-unread + the recent-read.
    const left = await store.listNotifications(A, 50);
    expect(left).toHaveLength(2);
    // The unread one is still counted as unread.
    expect(await store.getUnreadNotificationCount(A)).toBe(1);
  });

  it('pruneOldChat is a no-op (0) on the MemoryStore (match chat is dropped here)', async () => {
    const store = new MemoryStore();
    expect(await store.pruneOldChat(90 * 24 * 60 * 60 * 1000)).toBe(0);
  });
});

describe('DMs: canonicalization + isolation + thread order + preview', () => {
  it('ensureDmThread is symmetric (a,b)===(b,a)', async () => {
    const store = new MemoryStore();
    const t1 = await store.ensureDmThread(A, B);
    const t2 = await store.ensureDmThread(B, A);
    expect(t1).toBe(t2);
    expect(await store.dmThreadParticipants(t1)).toEqual(expect.arrayContaining([A, B]));
  });

  it('messages are isolated per thread and returned ascending', async () => {
    const store = new MemoryStore();
    const tAB = await store.ensureDmThread(A, B);
    const tAC = await store.ensureDmThread(A, C);
    await store.postDm(tAB, A, 'hey B');
    await store.postDm(tAB, B, 'hey A');
    await store.postDm(tAC, C, 'hey from C');

    const ab = await store.listDmMessages(tAB, { limit: 50 });
    expect(ab.map((m) => m.body)).toEqual(['hey B', 'hey A']);
    const ac = await store.listDmMessages(tAC, { limit: 50 });
    expect(ac.map((m) => m.body)).toEqual(['hey from C']);

    // sinceId delta in a thread.
    const since = await store.listDmMessages(tAB, { limit: 50, sinceId: ab[0]!.id });
    expect(since.map((m) => m.body)).toEqual(['hey A']);
  });

  it('listDmThreads is newest-first with the last-message preview', async () => {
    const store = new MemoryStore();
    const tAB = await store.ensureDmThread(A, B);
    const tAC = await store.ensureDmThread(A, C);
    await store.postDm(tAB, A, 'older AB');
    await store.postDm(tAC, A, 'newer AC');

    const threads = await store.listDmThreads(A);
    expect(threads.map((t) => t.threadId)).toEqual([tAC, tAB]);
    expect(threads[0]!.otherUserId).toBe(C);
    expect(threads[0]!.preview).toBe('newer AC');
    expect(threads[1]!.preview).toBe('older AB');

    // B sees only the AB thread, with A as the other party.
    const bThreads = await store.listDmThreads(B);
    expect(bThreads.map((t) => t.threadId)).toEqual([tAB]);
    expect(bThreads[0]!.otherUserId).toBe(A);
  });
});

describe('DM unread tracking (social v1)', () => {
  it('post → unread=1 for recipient, 0 after markDmRead; own messages never count', async () => {
    const store = new MemoryStore();
    const tAB = await store.ensureDmThread(A, B);
    // B sends a message → A has 1 unread, B (the sender) has 0.
    await store.postDm(tAB, B, 'hey A');
    expect(await store.getTotalUnread(A)).toBe(1);
    expect(await store.getTotalUnread(B)).toBe(0);
    const aThreads = await store.listDmThreads(A);
    expect(aThreads[0]!.unread).toBe(1);
    // A's own message to B does not count toward A's unread.
    await store.postDm(tAB, A, 'hey back');
    expect(await store.getTotalUnread(A)).toBe(1);
    // B now has 1 unread (A's reply).
    expect(await store.getTotalUnread(B)).toBe(1);

    // A reads the thread → A's unread clears.
    await store.markDmRead(A, tAB, Date.now() + 1_000_000);
    expect(await store.getTotalUnread(A)).toBe(0);
    expect((await store.listDmThreads(A))[0]!.unread).toBe(0);
    // B still unread until B reads.
    expect(await store.getTotalUnread(B)).toBe(1);
  });

  it('sums unread across multiple threads', async () => {
    const store = new MemoryStore();
    const tAB = await store.ensureDmThread(A, B);
    const tAC = await store.ensureDmThread(A, C);
    await store.postDm(tAB, B, 'one');
    await store.postDm(tAC, C, 'two');
    await store.postDm(tAC, C, 'three');
    expect(await store.getTotalUnread(A)).toBe(3);
    await store.markDmRead(A, tAC, Date.now() + 1_000_000);
    expect(await store.getTotalUnread(A)).toBe(1);
  });
});

describe('blocking (reuses mutes) — store effects', () => {
  it('blocked author excluded from room + forum reads; unblock restores', async () => {
    const store = new MemoryStore();
    const room = (await store.getRoomBySlug('parlor'))!;
    await store.postRoomMessage(room.id, A, 'from A');
    await store.postRoomMessage(room.id, B, 'from B');

    // A blocks B → A's room read excludes B's message.
    await store.setMute(A, B, true);
    const blocked = await store.getMutes(A);
    const filtered = await store.listRoomMessages(room.id, { limit: 50, blocked });
    expect(filtered.map((m) => m.body)).toEqual(['from A']);
    // An unblocked viewer (B) still sees everything.
    const unfiltered = await store.listRoomMessages(room.id, { limit: 50 });
    expect(unfiltered.map((m) => m.body)).toEqual(['from A', 'from B']);

    // Forum: a thread with posts from A and B.
    const board = (await store.listForumIndex())[0]!.boards[0]!;
    const fb = (await store.getBoardBySlug(board.slug))!;
    const { threadId } = await store.createThread(fb.id, A, 'topic', 'opener by A');
    await store.createPost(threadId, B, 'reply by B');
    const aView = await store.listPosts(threadId, { limit: 50, offset: 0, blocked });
    expect(aView.posts.map((p) => p.body)).toEqual(['opener by A']);
    expect(aView.total).toBe(1); // B's post excluded from the total too.

    // Unblock restores visibility.
    await store.setMute(A, B, false);
    const after = await store.listRoomMessages(room.id, {
      limit: 50,
      blocked: await store.getMutes(A),
    });
    expect(after.map((m) => m.body)).toEqual(['from A', 'from B']);
  });
});

describe('soft-delete (social v1)', () => {
  it('room: author deletes own → tombstone; non-author cannot; admin can', async () => {
    const store = new MemoryStore();
    const room = (await store.getRoomBySlug('parlor'))!;
    const m = await store.postRoomMessage(room.id, A, 'secret');
    // Non-author (B) cannot delete.
    expect(await store.deleteRoomMessage(m.id, B, false)).toBe('forbidden');
    // Author can.
    expect(await store.deleteRoomMessage(m.id, A, false)).toBe('ok');
    const list = await store.listRoomMessages(room.id, { limit: 50 });
    expect(list[0]!.deleted).toBe(true);
    expect(list[0]!.body).toBe('');
    // Unknown id → not_found.
    expect(await store.deleteRoomMessage('nope', A, false)).toBe('not_found');
  });

  it('DM: admin can delete anyone; tombstone nulls body; not counted unread', async () => {
    const store = new MemoryStore();
    const tAB = await store.ensureDmThread(A, B);
    const msg = await store.postDm(tAB, B, 'to delete');
    expect(await store.getTotalUnread(A)).toBe(1);
    // Admin (C) deletes B's message.
    expect(await store.deleteDmMessage(msg.id, C, true)).toBe('ok');
    const list = await store.listDmMessages(tAB, { limit: 50 });
    expect(list[0]!.deleted).toBe(true);
    expect(list[0]!.body).toBe('');
    // A deleted message no longer counts toward unread.
    expect(await store.getTotalUnread(A)).toBe(0);
  });

  it('forum: author deletes own post → tombstone; thread persists', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('strategy'))!;
    const { threadId } = await store.createThread(board.id, A, 'topic', 'opener');
    const reply = await store.createPost(threadId, A, 'a reply');
    expect(await store.deleteForumPost(reply!.postId, B, false)).toBe('forbidden');
    expect(await store.deleteForumPost(reply!.postId, A, false)).toBe('ok');
    const { posts } = await store.listPosts(threadId, { limit: 50, offset: 0 });
    const tomb = posts.find((p) => p.id === reply!.postId)!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.body).toBe('');
    // The thread (and its opener) persist.
    expect((await store.getThread(threadId))!.id).toBe(threadId);
  });
});

describe('user search (social v1)', () => {
  it('prefix + substring, excludes caller + blocked, respects limit', async () => {
    const store = new MemoryStore();
    store.setUsernameForTest(A, 'Capone');
    store.setUsernameForTest(B, 'Caponi');
    store.setUsernameForTest(C, 'Lucky');
    const D = 'user-dddddddd';
    store.setUsernameForTest(D, 'Scarface');

    // Min length: <2 chars returns [].
    expect(await store.searchUsers('c', 20)).toHaveLength(0);

    // Prefix matches rank above substring. 'cap' matches Capone, Caponi, Scarface.
    const hits = await store.searchUsers('cap', 20);
    // Capone/Caponi (prefix) rank above Scarface (substring 'cap' in scarfaCe? no);
    // 'cap' is a substring of 'Scarface'? S-c-a-r-f-a-c-e — no 'cap'. So only A,B.
    expect(hits.map((h) => h.username).sort()).toEqual(['Capone', 'Caponi']);

    // Exclude the caller (A) + a blocked id (B) → only... nothing left for 'cap'.
    const excl = await store.searchUsers('cap', 20, A, [B]);
    expect(excl).toHaveLength(0);

    // Substring match: 'ar' is in Scarface.
    const sub = await store.searchUsers('ar', 20);
    expect(sub.map((h) => h.username)).toContain('Scarface');

    // Limit is respected.
    const lim = await store.searchUsers('c', 1); // <2 → [] regardless
    expect(lim).toHaveLength(0);
    const lim2 = await store.searchUsers('ca', 1);
    expect(lim2).toHaveLength(1);
  });
});

describe('profiles + presence', () => {
  it('upsert round-trips and merges fields', async () => {
    const store = new MemoryStore();
    expect(await store.getProfile(A)).toBeNull();
    await store.upsertProfile(A, { tagline: 'The quiet type', bio: 'Plays the long game.' });
    let p = await store.getProfile(A);
    expect(p?.tagline).toBe('The quiet type');
    expect(p?.bio).toBe('Plays the long game.');
    expect(p?.accent).toBeNull();

    // Partial update keeps untouched fields.
    await store.upsertProfile(A, { accent: 'mafia' });
    p = await store.getProfile(A);
    expect(p?.tagline).toBe('The quiet type');
    expect(p?.accent).toBe('mafia');
  });

  it('touchPresence + getLastSeen', async () => {
    const store = new MemoryStore();
    expect(await store.getLastSeen([A, B])).toEqual({ [A]: null, [B]: null });
    await store.touchPresence(A, 1_700_000_000_000);
    const seen = await store.getLastSeen([A, B]);
    expect(seen[A]).toBe(1_700_000_000_000);
    expect(seen[B]).toBeNull();
  });
});
