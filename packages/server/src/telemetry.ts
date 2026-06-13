/**
 * Telemetry (BUILD_SPEC §15). In-memory counters + a daily rollup written to
 * `telemetry_daily`, surfaced at `/admin/stats`. Population-health instruments:
 * lobby wait, fill rate, completion rate, disconnect/resume, reports/match,
 * DAU/concurrents. Privacy-light: counts only, no PII.
 */

import type { Store } from './db/index.js';

interface Counters {
  lobbiesCreated: number;
  matchesStarted: number;
  matchesCompleted: number;
  disconnects: number;
  resumes: number;
  reports: number;
  lobbyWaitSamples: number;
  lobbyWaitTotalMs: number;
  fillSamples: number;
  fillSeatsFilled: number;
  fillSeatsCapacity: number;
  peakConcurrent: number;
}

function zeroCounters(): Counters {
  return {
    lobbiesCreated: 0,
    matchesStarted: 0,
    matchesCompleted: 0,
    disconnects: 0,
    resumes: 0,
    reports: 0,
    lobbyWaitSamples: 0,
    lobbyWaitTotalMs: 0,
    fillSamples: 0,
    fillSeatsFilled: 0,
    fillSeatsCapacity: 0,
    peakConcurrent: 0,
  };
}

export class Telemetry {
  private counters = zeroCounters();
  private readonly dauSet = new Set<string>();
  private concurrent = 0;
  private rollupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly store: Store) {}

  lobbyCreated(): void {
    this.counters.lobbiesCreated++;
  }
  matchStarted(seatsFilled: number, capacity: number, waitMs: number): void {
    this.counters.matchesStarted++;
    this.counters.lobbyWaitSamples++;
    this.counters.lobbyWaitTotalMs += waitMs;
    this.counters.fillSamples++;
    this.counters.fillSeatsFilled += seatsFilled;
    this.counters.fillSeatsCapacity += capacity;
  }
  matchCompleted(): void {
    this.counters.matchesCompleted++;
  }
  disconnect(): void {
    this.counters.disconnects++;
  }
  resume(): void {
    this.counters.resumes++;
  }
  report(): void {
    this.counters.reports++;
  }
  seenUser(id: string): void {
    this.dauSet.add(id);
  }
  connectionOpened(): void {
    this.concurrent++;
    if (this.concurrent > this.counters.peakConcurrent)
      this.counters.peakConcurrent = this.concurrent;
  }
  connectionClosed(): void {
    if (this.concurrent > 0) this.concurrent--;
  }

  /** JSON snapshot for `/admin/stats` (§15). */
  snapshot(): Record<string, number> {
    const c = this.counters;
    return {
      lobbiesCreated: c.lobbiesCreated,
      matchesStarted: c.matchesStarted,
      matchesCompleted: c.matchesCompleted,
      completionRate: c.matchesStarted ? c.matchesCompleted / c.matchesStarted : 0,
      avgLobbyWaitMs: c.lobbyWaitSamples ? c.lobbyWaitTotalMs / c.lobbyWaitSamples : 0,
      fillRate: c.fillSeatsCapacity ? c.fillSeatsFilled / c.fillSeatsCapacity : 0,
      disconnects: c.disconnects,
      resumes: c.resumes,
      resumeRate: c.disconnects ? c.resumes / c.disconnects : 0,
      reports: c.reports,
      reportsPerMatch: c.matchesStarted ? c.reports / c.matchesStarted : 0,
      dau: this.dauSet.size,
      concurrent: this.concurrent,
      peakConcurrent: c.peakConcurrent,
    };
  }

  /** Start the daily rollup writer (flushes counters to DB once per hour). */
  startRollups(): void {
    if (this.rollupTimer) return;
    this.rollupTimer = setInterval(() => void this.flush(), 60 * 60 * 1000);
    if (this.rollupTimer.unref) this.rollupTimer.unref();
  }

  stopRollups(): void {
    if (this.rollupTimer) {
      clearInterval(this.rollupTimer);
      this.rollupTimer = null;
    }
  }

  /** Write accumulated counters to today's rollup row and reset deltas (§15). */
  async flush(): Promise<void> {
    if (!this.store.persistent) return;
    const day = new Date().toISOString().slice(0, 10);
    const c = this.counters;
    await this.store.upsertDailyRollup(day, {
      lobbies_created: c.lobbiesCreated,
      matches_started: c.matchesStarted,
      matches_completed: c.matchesCompleted,
      disconnects: c.disconnects,
      resumes: c.resumes,
      reports: c.reports,
      dau: this.dauSet.size,
      peak_concurrent: c.peakConcurrent,
    });
    // Reset cumulative-delta counters; keep peak/dau within the day window.
    this.counters = zeroCounters();
  }
}
