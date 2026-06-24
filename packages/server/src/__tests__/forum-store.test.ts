/**
 * Forum store state machines + reads against the NO_DB MemoryStore (Forums
 * feature). MemoryStore is guests-only, so account-gated route happy-paths are
 * covered here at the store level with synthetic user ids; the route file is
 * exercised separately (forum-routes.test.ts) for the guest/anon 403/404 path.
 *
 * The seeded categories/boards mirror default-forum.ts (and schema.sql).
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import { DEFAULT_FORUM } from '../db/default-forum.js';

const A = 'user-aaaaaaaa';
const B = 'user-bbbbbbbb';

describe('forum index seed', () => {
  it('seeds the 3 default categories and 5 boards (ordered by sort)', async () => {
    const store = new MemoryStore();
    const index = await store.listForumIndex();
    expect(index.map((c) => c.category.slug)).toEqual(['the-family', 'the-game', 'after-hours']);
    const allBoards = index.flatMap((c) => c.boards.map((b) => b.slug));
    expect(allBoards).toEqual([
      'announcements',
      'introductions',
      'strategy',
      'results',
      'offtopic',
    ]);
    // Matches the shared seed module.
    const expectedBoards = DEFAULT_FORUM.flatMap((c) => c.boards.map((b) => b.slug));
    expect(allBoards).toEqual(expectedBoards);

    // Every board starts empty.
    for (const cat of index) {
      for (const b of cat.boards) {
        expect(b.threadCount).toBe(0);
        expect(b.postCount).toBe(0);
        expect(b.lastPost).toBeNull();
      }
    }
  });

  it('getBoardBySlug resolves a known board and null for an unknown one', async () => {
    const store = new MemoryStore();
    const strategy = await store.getBoardBySlug('strategy');
    expect(strategy?.name).toBe('Strategy & Roles');
    expect(await store.getBoardBySlug('nope')).toBeNull();
  });
});

describe('createThread + listPosts + first post', () => {
  it('creates a thread with an opening post (post_count 1) and lists it', async () => {
    const store = new MemoryStore();
    store.setUsernameForTest(A, 'Capone');
    const board = (await store.getBoardBySlug('strategy'))!;
    const { threadId, postId } = await store.createThread(board.id, A, 'On the Jailor', 'Open day 1.');
    expect(threadId).toBeTruthy();
    expect(postId).toBeTruthy();

    const thread = await store.getThread(threadId);
    expect(thread?.title).toBe('On the Jailor');
    expect(thread?.postCount).toBe(1);
    expect(thread?.boardSlug).toBe('strategy');
    expect(thread?.authorName).toBe('Capone');

    const { posts, total } = await store.listPosts(threadId, { limit: 20, offset: 0 });
    expect(total).toBe(1);
    expect(posts.map((p) => p.body)).toEqual(['Open day 1.']);
    expect(posts[0]!.id).toBe(postId);
    expect(posts[0]!.editedAt).toBeNull();
  });

  it('authorJoined is exposed when a join date is known', async () => {
    const store = new MemoryStore();
    store.setUserJoinedForTest(A, 1_700_000_000_000);
    const board = (await store.getBoardBySlug('offtopic'))!;
    const { threadId } = await store.createThread(board.id, A, 'Hello', 'Hi all.');
    const { posts } = await store.listPosts(threadId, { limit: 20, offset: 0 });
    expect(posts[0]!.authorJoined).toBe(1_700_000_000_000);
  });
});

describe('createPost appends + bumps thread + board index', () => {
  it('appends a reply, bumps post_count/last_post_at, and updates the board lastPost', async () => {
    const store = new MemoryStore();
    store.setUsernameForTest(A, 'Capone');
    store.setUsernameForTest(B, 'Torrio');
    const board = (await store.getBoardBySlug('strategy'))!;
    const { threadId } = await store.createThread(board.id, A, 'On the Jailor', 'Open day 1.');

    const reply = await store.createPost(threadId, B, 'Counterpoint.');
    expect(reply).not.toBeNull();

    const thread = await store.getThread(threadId);
    expect(thread?.postCount).toBe(2);

    const { posts, total } = await store.listPosts(threadId, { limit: 20, offset: 0 });
    expect(total).toBe(2);
    expect(posts.map((p) => p.body)).toEqual(['Open day 1.', 'Counterpoint.']);

    // The board's index entry now reflects the latest post (Torrio's reply).
    const index = await store.listForumIndex();
    const strategyBoard = index
      .flatMap((c) => c.boards)
      .find((b) => b.slug === 'strategy')!;
    expect(strategyBoard.threadCount).toBe(1);
    expect(strategyBoard.postCount).toBe(2);
    expect(strategyBoard.lastPost?.threadId).toBe(threadId);
    expect(strategyBoard.lastPost?.threadTitle).toBe('On the Jailor');
    expect(strategyBoard.lastPost?.username).toBe('Torrio');
  });

  it('returns null for a missing thread', async () => {
    const store = new MemoryStore();
    expect(await store.createPost('no-such-thread', A, 'hi')).toBeNull();
  });
});

describe('listThreads ordering + pagination', () => {
  it('returns pinned threads first, then newest activity', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('strategy'))!;
    const { threadId: t1 } = await store.createThread(board.id, A, 'First', 'a');
    const { threadId: t2 } = await store.createThread(board.id, A, 'Second', 'b');
    const { threadId: t3 } = await store.createThread(board.id, A, 'Third', 'c');

    // Without pins, newest-activity-first: t3, t2, t1.
    const first = await store.listThreads(board.id, { limit: 30, offset: 0 });
    let threads = first.threads;
    expect(first.total).toBe(3);
    expect(threads.map((t) => t.id)).toEqual([t3, t2, t1]);

    // Pin the oldest thread → it jumps to the front.
    expect(await store.setThreadFlags(t1, { pinned: true })).toBe(true);
    ({ threads } = await store.listThreads(board.id, { limit: 30, offset: 0 }));
    expect(threads[0]!.id).toBe(t1);
    expect(threads[0]!.pinned).toBe(true);
    expect(threads.map((t) => t.id)).toEqual([t1, t3, t2]);
  });

  it('honors limit + offset', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('results'))!;
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { threadId } = await store.createThread(board.id, A, `T${i}`, 'x');
      ids.push(threadId);
    }
    // Newest first: ids reversed.
    const page1 = await store.listThreads(board.id, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.threads.map((t) => t.id)).toEqual([ids[4], ids[3]]);
    const page2 = await store.listThreads(board.id, { limit: 2, offset: 2 });
    expect(page2.threads.map((t) => t.id)).toEqual([ids[2], ids[1]]);
  });
});

describe('searchForum (QoL search)', () => {
  it('matches thread titles and post bodies, newest-first', async () => {
    const store = new MemoryStore();
    store.setUsernameForTest(A, 'Capone');
    const board = (await store.getBoardBySlug('strategy'))!;
    // A thread whose TITLE matches "jailor".
    const { threadId: t1 } = await store.createThread(
      board.id,
      A,
      'On the Jailor',
      'Open thoughts.',
    );
    // A different thread whose BODY (a reply) matches "jailor".
    const { threadId: t2 } = await store.createThread(board.id, A, 'Random topic', 'nothing here');
    await store.createPost(t2, A, 'I think the jailor should hold.');

    const hits = await store.searchForum('jailor', 30);
    // Two matches: the title hit (t1) and the body hit (t2).
    expect(hits).toHaveLength(2);
    const titleHit = hits.find((h) => h.matchedIn === 'title');
    const postHit = hits.find((h) => h.matchedIn === 'post');
    expect(titleHit?.threadId).toBe(t1);
    expect(titleHit?.snippet).toBe('On the Jailor');
    expect(titleHit?.boardSlug).toBe('strategy');
    expect(titleHit?.boardName).toBe('Strategy & Roles');
    expect(postHit?.threadId).toBe(t2);
    expect(postHit?.snippet).toContain('jailor');
    // Newest-first across both (the reply was created after t1's title).
    expect(hits[0]!.matchedIn).toBe('post');
  });

  it('is case-insensitive', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('strategy'))!;
    await store.createThread(board.id, A, 'The DOCTOR Heals', 'x');
    const hits = await store.searchForum('doctor', 30);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.matchedIn).toBe('title');
  });

  it('excludes soft-deleted posts from body matches', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('offtopic'))!;
    const { threadId } = await store.createThread(board.id, A, 'Topic', 'opening line');
    const reply = await store.createPost(threadId, A, 'secretword appears here');
    // Before deletion: the reply matches.
    expect((await store.searchForum('secretword', 30)).length).toBe(1);
    // After soft-delete: the reply no longer matches.
    await store.deleteForumPost(reply!.postId, A, false);
    expect(await store.searchForum('secretword', 30)).toEqual([]);
  });

  it('respects the limit (≤30) and a 2-char minimum', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('results'))!;
    for (let i = 0; i < 5; i += 1) {
      await store.createThread(board.id, A, `match topic ${i}`, 'body');
    }
    const limited = await store.searchForum('match', 2);
    expect(limited).toHaveLength(2);
    // Below the minimum returns nothing.
    expect(await store.searchForum('a', 30)).toEqual([]);
    expect(await store.searchForum('  ', 30)).toEqual([]);
  });

  it('returns [] when nothing matches', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('strategy'))!;
    await store.createThread(board.id, A, 'Hello world', 'just a body');
    expect(await store.searchForum('zzzznomatch', 30)).toEqual([]);
  });
});

describe('locked threads + views + edit', () => {
  it('createPost returns null when the thread is locked', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('announcements'))!;
    const { threadId } = await store.createThread(board.id, A, 'Notice', 'No replies.');
    expect(await store.setThreadFlags(threadId, { locked: true })).toBe(true);
    expect(await store.createPost(threadId, B, 'can I reply?')).toBeNull();
  });

  it('incrementThreadViews bumps the counter', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('offtopic'))!;
    const { threadId } = await store.createThread(board.id, A, 'Views', 'x');
    expect((await store.getThread(threadId))?.views).toBe(0);
    await store.incrementThreadViews(threadId);
    await store.incrementThreadViews(threadId);
    expect((await store.getThread(threadId))?.views).toBe(2);
  });

  it('editPost is author-only (or admin) and sets edited_at', async () => {
    const store = new MemoryStore();
    const board = (await store.getBoardBySlug('offtopic'))!;
    const { threadId, postId } = await store.createThread(board.id, A, 'Edit me', 'original');

    // A stranger cannot edit.
    expect(await store.editPost(postId, B, false, 'hacked')).toBe(false);
    // The author can.
    expect(await store.editPost(postId, A, false, 'updated')).toBe(true);
    let posts = (await store.listPosts(threadId, { limit: 20, offset: 0 })).posts;
    expect(posts[0]!.body).toBe('updated');
    expect(posts[0]!.editedAt).not.toBeNull();

    // An admin may edit anyone's post.
    expect(await store.editPost(postId, B, true, 'mod-edit')).toBe(true);
    posts = (await store.listPosts(threadId, { limit: 20, offset: 0 })).posts;
    expect(posts[0]!.body).toBe('mod-edit');

    // Editing a missing post fails.
    expect(await store.editPost('no-such-post', A, true, 'x')).toBe(false);
  });
});
