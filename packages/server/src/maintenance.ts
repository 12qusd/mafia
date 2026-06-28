/**
 * In-server daily maintenance (chat retention + read-notification pruning).
 *
 * The chat 90-day retention used to be a documented-but-manual operational job
 * (weekly partitions + DROP PARTITION). This service runs it IN-SERVER on a
 * daily tick: a plain time-windowed `DELETE FROM chat_messages` (correct +
 * simple at this scale — partition DROP is premature here). It also prunes READ
 * notifications older than 30 days (Wave-5a left them unpruned).
 *
 * HTTP/DB-only with its own timer — this NEVER touches the engine, the game WS
 * protocol, or the §5 information-leak path. Mirrors the Telemetry rollup
 * pattern: `setInterval(...).unref()`, started in app.ts after listen() and
 * stopped in shutdown(). Every sweep is BEST-EFFORT (a failure is logged, never
 * thrown) and a no-op under a non-persistent store (NO_DB).
 */

import type { Store } from './db/index.js';
import type { MaintenanceConfig } from './config.js';
import { log } from './log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Run the first sweep shortly after boot (not at t=0) so listen() settles. */
const BOOT_SWEEP_DELAY_MS = 30_000;

export class Maintenance {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly cfg: MaintenanceConfig,
  ) {}

  /**
   * Start the daily tick. A no-op under a non-persistent store (nothing to
   * prune). Also schedules one sweep shortly after boot so a long-lived process
   * does not wait a full interval for its first cleanup.
   */
  start(): void {
    if (!this.store.persistent) return;
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), this.cfg.intervalMs);
    if (this.timer.unref) this.timer.unref();
    // One sweep shortly after boot (best-effort; never blocks startup).
    this.bootTimer = setTimeout(() => void this.sweep(), BOOT_SWEEP_DELAY_MS);
    if (this.bootTimer.unref) this.bootTimer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
  }

  /**
   * Run one retention sweep: prune old chat + old READ notifications. Each step
   * is independently best-effort — a failure is logged and the next step still
   * runs. Returns the rows deleted per surface (useful for tests/observability).
   */
  async sweep(): Promise<{ chat: number; notifications: number }> {
    const result = { chat: 0, notifications: 0 };
    if (!this.store.persistent) return result;
    try {
      result.chat = await this.store.pruneOldChat(this.cfg.chatRetentionDays * DAY_MS);
    } catch (err) {
      log.warn('maintenance: chat prune failed', { err: String(err) });
    }
    try {
      result.notifications = await this.store.pruneOldNotifications(
        this.cfg.notificationRetentionDays * DAY_MS,
      );
    } catch (err) {
      log.warn('maintenance: notification prune failed', { err: String(err) });
    }
    if (result.chat > 0 || result.notifications > 0) {
      log.info('maintenance sweep', {
        chatDeleted: result.chat,
        notificationsDeleted: result.notifications,
        chatRetentionDays: this.cfg.chatRetentionDays,
        notificationRetentionDays: this.cfg.notificationRetentionDays,
      });
    }
    return result;
  }
}
