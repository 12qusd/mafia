/**
 * Maintenance service (chat retention + read-notification pruning) checks.
 *
 * The sweep is best-effort + persistent-only. Under the NO_DB MemoryStore the
 * service is inert (start() is a no-op, sweep() returns zeros) because
 * `store.persistent` is false. To exercise the real sweep we make the
 * MemoryStore present as persistent and seed old/recent rows.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';
import { Maintenance } from '../maintenance.js';
import type { MaintenanceConfig } from '../config.js';

afterEach(() => {
  vi.useRealTimers();
});

const CFG: MaintenanceConfig = {
  chatRetentionDays: 90,
  notificationRetentionDays: 30,
  intervalMs: 24 * 60 * 60 * 1000,
  instanceHeartbeatMs: 30_000,
  instanceStaleMs: 90_000,
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
    expect(res).toEqual({ chat: 0, notifications: 0, instances: 0 });
    m.stop();
  });

  it('prunes stale server-instance rows in the sweep (idempotent / best-effort)', async () => {
    const store = new MemoryStore();
    makePersistent(store);
    vi.useFakeTimers();
    const base = Date.now();

    // An old instance registered now, then time advances past the stale window.
    await store.registerInstance('inst-dead', 'h', 'v');
    const m = new Maintenance(store, CFG, { id: 'inst-live', host: 'h', version: 'v' });

    // Advance past the stale window, then register a fresh (live) instance.
    vi.setSystemTime(base + CFG.instanceStaleMs + 10_000);
    await store.registerInstance('inst-live', 'h', 'v');

    // The sweep prunes the dead row only; chat/notifications are zero here.
    const res = await m.sweep();
    expect(res.instances).toBe(1);
    expect(res.chat).toBe(0);
    expect((await store.listLiveInstances(CFG.instanceStaleMs)).map((i) => i.id)).toEqual([
      'inst-live',
    ]);
  });

  it('register/heartbeat/deregister an instance are best-effort + persistent-gated', async () => {
    const store = new MemoryStore();
    makePersistent(store);
    const m = new Maintenance(store, CFG, { id: 'inst-a', host: 'host-1', version: 'b1' });
    await m.registerInstance();
    expect((await store.listLiveInstances(CFG.instanceStaleMs)).map((i) => i.id)).toEqual([
      'inst-a',
    ]);
    await m.deregisterInstance();
    expect(await store.listLiveInstances(CFG.instanceStaleMs)).toHaveLength(0);
  });

  it('register/deregister are inert under a non-persistent store (no throw, no rows)', async () => {
    const store = new MemoryStore(); // persistent === false
    const m = new Maintenance(store, CFG, { id: 'inst-a', host: 'h', version: 'v' });
    await m.registerInstance();
    await m.deregisterInstance();
    // Nothing registered (persistent gate); methods resolve without throwing.
    expect(await store.listLiveInstances(CFG.instanceStaleMs)).toHaveLength(0);
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
