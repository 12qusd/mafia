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
