/**
 * PgStore registry/online-count query-shape checks (no live Postgres).
 *
 * We drive PgStore with a fake pg Pool that captures the SQL text + params, so
 * we can assert the window/stale parameters are passed (not string-interpolated)
 * and the registry upsert/heartbeat/prune statements are well-formed. The SQL
 * itself still needs a live-Postgres smoke (noted in the report); this guards
 * the wiring + parameterization.
 */

import { describe, it, expect } from 'vitest';
import { PgStore } from '../db/pg-store.js';

interface Captured {
  text: string;
  params: unknown[];
}

/** Build a PgStore over a fake Pool that records queries and returns `rows`. */
function fakePgStore(rows: unknown[] = []): { store: PgStore; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params ?? [] });
      return { rows, rowCount: rows.length };
    },
  };
  // PgStore only uses pool.query for these methods.
  const store = new PgStore(pool as never);
  return { store, calls };
}

describe('PgStore.getOnlineCount — parameterized window', () => {
  it('passes the window (ms) as a bound parameter, not interpolated', async () => {
    const { store, calls } = fakePgStore([{ n: '7' }]);
    const count = await store.getOnlineCount(120_000);
    expect(count).toBe(7);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.text).toContain('last_seen_at');
    expect(call.text).toContain('interval');
    expect(call.text).toContain('$1'); // window is a placeholder
    expect(call.text).not.toContain('120000'); // never interpolated literally
    expect(call.params).toEqual([120_000]);
  });

  it('floors + clamps a negative/fractional window to a safe integer', async () => {
    const { store, calls } = fakePgStore([{ n: '0' }]);
    await store.getOnlineCount(-5.7);
    expect(calls[0]!.params).toEqual([0]);
  });
});

describe('PgStore — instance registry query shapes', () => {
  it('registerInstance upserts on conflict, binding id/host/version', async () => {
    const { store, calls } = fakePgStore();
    await store.registerInstance('inst-a', 'host-1', 'build-1');
    const call = calls[0]!;
    expect(call.text).toContain('INSERT INTO server_instances');
    expect(call.text).toContain('ON CONFLICT (id) DO UPDATE');
    expect(call.params).toEqual(['inst-a', 'host-1', 'build-1']);
  });

  it('heartbeatInstance bumps last_heartbeat_at by id', async () => {
    const { store, calls } = fakePgStore();
    await store.heartbeatInstance('inst-a');
    expect(calls[0]!.text).toContain('UPDATE server_instances');
    expect(calls[0]!.text).toContain('last_heartbeat_at = now()');
    expect(calls[0]!.params).toEqual(['inst-a']);
  });

  it('listLiveInstances filters by a bound stale window + orders newest-first', async () => {
    const { store, calls } = fakePgStore([
      {
        id: 'inst-a',
        host: 'h',
        version: 'v',
        started_at: new Date(1000),
        last_heartbeat_at: new Date(2000),
      },
    ]);
    const live = await store.listLiveInstances(90_000);
    expect(live).toEqual([
      { id: 'inst-a', host: 'h', version: 'v', startedAt: 1000, lastHeartbeatAt: 2000 },
    ]);
    const call = calls[0]!;
    expect(call.text).toContain('ORDER BY last_heartbeat_at DESC');
    expect(call.text).toContain('$1');
    expect(call.params).toEqual([90_000]);
  });

  it('pruneStaleInstances deletes by a bound stale window and returns rowCount', async () => {
    const { store, calls } = fakePgStore([{}, {}]); // 2 rows "deleted"
    const n = await store.pruneStaleInstances(90_000);
    expect(n).toBe(2);
    expect(calls[0]!.text).toContain('DELETE FROM server_instances');
    expect(calls[0]!.params).toEqual([90_000]);
  });

  it('removeInstance deletes a single id', async () => {
    const { store, calls } = fakePgStore();
    await store.removeInstance('inst-a');
    expect(calls[0]!.text).toContain('DELETE FROM server_instances');
    expect(calls[0]!.params).toEqual(['inst-a']);
  });
});
