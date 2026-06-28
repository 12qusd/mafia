/**
 * Maintenance service (chat retention + read-notification pruning) checks.
 *
 * The sweep is best-effort + persistent-only. Under the NO_DB MemoryStore the
 * service is inert (start() is a no-op, sweep() returns zeros) because
 * `store.persistent` is false. To exercise the real sweep we make the
 * MemoryStore present as persistent and seed old/recent rows.
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import { Maintenance } from '../maintenance.js';
import type { MaintenanceConfig } from '../config.js';

const CFG: MaintenanceConfig = {
  chatRetentionDays: 90,
  notificationRetentionDays: 30,
  intervalMs: 24 * 60 * 60 * 1000,
};

const DAY = 24 * 60 * 60 * 1000;
const A = 'user-aaaaaaaa';

/** Make the MemoryStore present as persistent for the duration of a test. */
function makePersistent(store: MemoryStore): void {
  Object.defineProperty(store, 'persistent', { value: true, configurable: true });
}

describe('Maintenance.sweep', () => {
  it('is inert under a non-persistent store (zeros, no start)', async () => {
    const store = new MemoryStore(); // persistent === false
    const m = new Maintenance(store, CFG);
    m.start(); // no-op
    const res = await m.sweep();
    expect(res).toEqual({ chat: 0, notifications: 0 });
    m.stop();
  });

  it('prunes only old READ notifications when persistent', async () => {
    const store = new MemoryStore();
    makePersistent(store);
    const now = Date.now();
    store.seedNotificationForTest(A, 'rank_up', now - 40 * DAY, now - 40 * DAY); // old read → pruned
    store.seedNotificationForTest(A, 'rank_up', now - 40 * DAY, null); // old unread → kept
    store.seedNotificationForTest(A, 'rank_up', now - 1 * DAY, now - 1 * DAY); // recent read → kept

    const m = new Maintenance(store, CFG);
    const res = await m.sweep();
    expect(res.notifications).toBe(1);
    // MemoryStore drops match chat, so chat prune is always 0.
    expect(res.chat).toBe(0);
    expect(await store.listNotifications(A, 50)).toHaveLength(2);
  });

  it('start()/stop() are idempotent and do not throw', () => {
    const store = new MemoryStore();
    makePersistent(store);
    const m = new Maintenance(store, CFG);
    m.start();
    m.start(); // second start is a no-op (timer already set)
    m.stop();
    m.stop(); // second stop is safe
  });
});
