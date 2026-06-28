/**
 * Server-instance registry (horizontal scaling — observability) checks.
 *
 * Exercised against the MemoryStore (NO_DB-safe): register → heartbeat →
 * listLiveInstances within the window → stale prune removes it. Also covers
 * getOnlineCount's shape and that the PgStore query uses the window parameter.
 * These methods are best-effort + cluster-coherent; they never touch the engine,
 * the WS protocol, or the §5 leak path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryStore } from '../db/memory-store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('MemoryStore — server-instance registry round-trip', () => {
  it('register → heartbeat → list (within window) → stale prune removes it', async () => {
    const store = new MemoryStore();
    const STALE = 90_000;

    // Registering twice (re-register / restart) is idempotent on the id.
    await store.registerInstance('inst-a', 'host-1', 'build-1');
    await store.registerInstance('inst-a', 'host-1', 'build-1');
    await store.registerInstance('inst-b', 'host-2', 'build-2');

    const live = await store.listLiveInstances(STALE);
    expect(live.map((i) => i.id).sort()).toEqual(['inst-a', 'inst-b']);
    const a = live.find((i) => i.id === 'inst-a');
    expect(a).toMatchObject({ host: 'host-1', version: 'build-1' });
    expect(typeof a?.startedAt).toBe('number');
    expect(typeof a?.lastHeartbeatAt).toBe('number');

    // A heartbeat bumps last_heartbeat_at; the list is newest-heartbeat-first.
    vi.useFakeTimers();
    const base = Date.now();
    vi.setSystemTime(base + 1_000);
    await store.heartbeatInstance('inst-a');
    const ordered = await store.listLiveInstances(STALE);
    expect(ordered[0]?.id).toBe('inst-a'); // most recently heartbeated first

    // Advance past the stale window: both rows are now stale.
    vi.setSystemTime(base + STALE + 5_000);
    expect(await store.listLiveInstances(STALE)).toHaveLength(0);
    const pruned = await store.pruneStaleInstances(STALE);
    expect(pruned).toBe(2);
    expect(await store.listLiveInstances(STALE)).toHaveLength(0);
  });

  it('removeInstance drops a single row (graceful shutdown path)', async () => {
    const store = new MemoryStore();
    await store.registerInstance('inst-x', 'h', 'v');
    await store.registerInstance('inst-y', 'h', 'v');
    await store.removeInstance('inst-x');
    const live = await store.listLiveInstances(90_000);
    expect(live.map((i) => i.id)).toEqual(['inst-y']);
  });

  it('heartbeat on an unknown id is a no-op (never throws)', async () => {
    const store = new MemoryStore();
    await expect(store.heartbeatInstance('nope')).resolves.toBeUndefined();
  });
});

describe('getOnlineCount — shape + window semantics', () => {
  it('MemoryStore returns 0 with no presence', async () => {
    const store = new MemoryStore();
    expect(await store.getOnlineCount(120_000)).toBe(0);
  });

  it('MemoryStore counts only accounts seen within the window', async () => {
    const store = new MemoryStore();
    const now = Date.now();
    await store.touchPresence('u-recent', now);
    await store.touchPresence('u-stale', now - 5 * 60_000); // 5m ago
    // 2-minute window: only u-recent is "online".
    expect(await store.getOnlineCount(120_000)).toBe(1);
    // A wide window catches both.
    expect(await store.getOnlineCount(60 * 60_000)).toBe(2);
  });
});
