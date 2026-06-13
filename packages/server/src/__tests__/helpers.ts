/**
 * Test helpers: a fake socket capturing sent frames, and a context builder over
 * the NO_DB store so tests exercise real code paths without Postgres.
 */

import { loadConfig } from '../config.js';
import { MemoryStore } from '../db/memory-store.js';
import { IdentityService } from '../auth/identity.js';
import { LobbyManager } from '../lobby/manager.js';
import { Moderation } from '../moderation/moderation.js';
import { Telemetry } from '../telemetry.js';
import { makeFallbackEngine } from '../engine-fallback.js';
import type { ScheduleFn } from '../room/room.js';
import type { GatewayContext } from '../ws/context.js';
import type { RawSocket } from '../ws/connection.js';

/**
 * Deterministic virtual clock for driving the full game loop without wall-clock
 * waits (BUILD_SPEC §6.2). `clock()` returns virtual "now"; `schedule(cb, ms)`
 * registers a timer at `now + ms`. `advance(ms)` moves time forward, firing all
 * timers whose deadline is reached in chronological order — including timers
 * scheduled *during* a callback (the game loop reschedules the next deadline as
 * each phase ends), so a single large `advance` can drive many phases.
 */
export class FakeClock {
  private now = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; cb: () => void }>();

  readonly clock = (): number => this.now;

  readonly schedule: ScheduleFn = (cb, ms) => {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + Math.max(0, ms), cb });
    return {
      cancel: () => {
        this.timers.delete(id);
      },
    };
  };

  /** Advance virtual time by `ms`, firing due timers (cascading reschedules). */
  advance(ms: number): void {
    const target = this.now + ms;
    // Loop: repeatedly fire the earliest due timer until none remain <= target.
    for (;;) {
      let next: { id: number; at: number; cb: () => void } | null = null;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (!next || t.at < next.at)) next = { id, ...t };
      }
      if (!next) break;
      this.timers.delete(next.id);
      this.now = next.at;
      next.cb();
    }
    this.now = target;
  }

  /** Number of pending timers (a finished game schedules none). */
  get pending(): number {
    return this.timers.size;
  }
}

export class FakeSocket implements RawSocket {
  readyState = 1; // OPEN
  readonly sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
    this.closed = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
    this.emit('close');
  }
  on(event: string, listener: (...args: unknown[]) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener);
    this.listeners.set(event, arr);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }
  /** Frames of a given type. */
  ofType(type: string): unknown[] {
    return this.sent.filter((m) => (m as { type?: string }).type === type);
  }
  lastOfType(type: string): Record<string, unknown> | undefined {
    const arr = this.ofType(type);
    return arr[arr.length - 1] as Record<string, unknown> | undefined;
  }
}

export function buildTestContext(opts: { clock?: FakeClock; testModeEnv?: boolean; bots?: unknown } = {}): {
  ctx: GatewayContext;
  store: MemoryStore;
} {
  const cfg = { ...loadConfig({ NO_DB: '1' } as NodeJS.ProcessEnv), noDb: true, databaseUrl: undefined };
  const store = new MemoryStore();
  const identity = new IdentityService(store, cfg);
  const moderation = new Moderation(store);
  const telemetry = new Telemetry(store);
  const engine = makeFallbackEngine();
  const names = new Map<string, string>();
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  const origGuest = identity.createGuest.bind(identity);
  identity.createGuest = () => {
    const g = origGuest();
    names.set(g.identity.id, g.identity.name);
    return g;
  };
  const manager = new LobbyManager({
    engine,
    store,
    telemetry,
    serverBuild: 'test',
    nameOf,
    ...(opts.testModeEnv ? { testModeEnv: true } : {}),
    ...(opts.bots ? { bots: opts.bots as never } : {}),
    ...(opts.clock ? { schedule: opts.clock.schedule, clock: opts.clock.clock } : {}),
  });
  const ctx: GatewayContext = { cfg, store, identity, manager, moderation, telemetry, nameOf };
  return { ctx, store };
}
