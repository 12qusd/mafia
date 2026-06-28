/**
 * In-server maintenance: retention pruning + server-instance heartbeat/prune.
 *
 * The chat 90-day retention used to be a documented-but-manual operational job
 * (weekly partitions + DROP PARTITION). This service runs it IN-SERVER on a
 * daily tick: a plain time-windowed `DELETE FROM chat_messages` (correct +
 * simple at this scale — partition DROP is premature here). It also prunes READ
 * notifications older than 30 days (Wave-5a left them unpruned).
 *
 * Horizontal scaling (observability): this service ALSO owns this instance's
 * row in the `server_instances` registry — it bumps `last_heartbeat_at` on a
 * ~30s timer and, in the daily sweep, prunes any instance row that stopped
 * heartbeating (a crashed/killed peer). Registration (boot) and removal
 * (graceful shutdown) are driven explicitly by app.ts. Pruning is idempotent +
 * best-effort, so running it on EVERY instance is safe (whichever instance
 * sweeps first removes the dead rows; the rest find nothing to do).
 *
 * HTTP/DB-only with its own timers — this NEVER touches the engine, the game WS
 * protocol, or the §5 information-leak path. Mirrors the Telemetry rollup
 * pattern: `setInterval(...).unref()`, started in app.ts after listen() and
 * stopped in shutdown(). Every sweep step is BEST-EFFORT (a failure is logged,
 * never thrown) and a no-op under a non-persistent store (NO_DB).
 */

import type { Store } from './db/index.js';
import type { MaintenanceConfig } from './config.js';
import { log } from './log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Run the first sweep shortly after boot (not at t=0) so listen() settles. */
const BOOT_SWEEP_DELAY_MS = 30_000;

/** Identity of THIS process in the server-instance registry. */
export interface InstanceIdentity {
  id: string;
  host: string;
  version: string;
}

export class Maintenance {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly cfg: MaintenanceConfig,
    /** This instance's registry identity. Absent ⇒ heartbeat/register skipped. */
    private readonly instance?: InstanceIdentity,
  ) {}

  /**
   * Start the daily retention tick + the ~30s instance heartbeat. A no-op under
   * a non-persistent store (nothing to prune / no shared registry). Also
   * schedules one sweep shortly after boot so a long-lived process does not wait
   * a full interval for its first cleanup. Both timers are unref'd so they never
   * keep the process alive.
   */
  start(): void {
    if (!this.store.persistent) return;
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), this.cfg.intervalMs);
    if (this.timer.unref) this.timer.unref();
    // One sweep shortly after boot (best-effort; never blocks startup).
    this.bootTimer = setTimeout(() => void this.sweep(), BOOT_SWEEP_DELAY_MS);
    if (this.bootTimer.unref) this.bootTimer.unref();
    // Instance heartbeat: bump last_heartbeat_at on a short cadence so peers see
    // this instance as live. Best-effort; never throws.
    if (this.instance) {
      this.heartbeatTimer = setInterval(
        () => void this.heartbeat(),
        this.cfg.instanceHeartbeatMs,
      );
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Register THIS instance in the shared registry (boot). Best-effort +
   * persistent-only — a failure is logged and never blocks startup.
   */
  async registerInstance(): Promise<void> {
    if (!this.store.persistent || !this.instance) return;
    try {
      await this.store.registerInstance(
        this.instance.id,
        this.instance.host,
        this.instance.version,
      );
      log.info('instance registered', {
        instanceId: this.instance.id,
        host: this.instance.host,
        version: this.instance.version,
      });
    } catch (err) {
      log.warn('instance register failed', { err: String(err) });
    }
  }

  /**
   * Remove THIS instance's registry row (graceful shutdown). Best-effort: a
   * failure is logged; the stale-prune in any peer's sweep is the safety net.
   */
  async deregisterInstance(): Promise<void> {
    if (!this.store.persistent || !this.instance) return;
    try {
      await this.store.removeInstance(this.instance.id);
    } catch (err) {
      log.warn('instance deregister failed', { err: String(err) });
    }
  }

  /** One heartbeat: bump this instance's last_heartbeat_at. Best-effort. */
  private async heartbeat(): Promise<void> {
    if (!this.store.persistent || !this.instance) return;
    try {
      await this.store.heartbeatInstance(this.instance.id);
    } catch (err) {
      log.warn('instance heartbeat failed', { err: String(err) });
    }
  }

  /**
   * Run one maintenance sweep: prune old chat, old READ notifications, AND stale
   * instance rows. Each step is independently best-effort — a failure is logged
   * and the next step still runs. Returns the rows affected per surface (useful
   * for tests/observability).
   */
  async sweep(): Promise<{ chat: number; notifications: number; instances: number }> {
    const result = { chat: 0, notifications: 0, instances: 0 };
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
    try {
      // Idempotent + best-effort: safe to run on every instance (whoever sweeps
      // first clears the dead rows; the rest find nothing).
      result.instances = await this.store.pruneStaleInstances(this.cfg.instanceStaleMs);
    } catch (err) {
      log.warn('maintenance: instance prune failed', { err: String(err) });
    }
    if (result.chat > 0 || result.notifications > 0 || result.instances > 0) {
      log.info('maintenance sweep', {
        chatDeleted: result.chat,
        notificationsDeleted: result.notifications,
        staleInstancesPruned: result.instances,
        chatRetentionDays: this.cfg.chatRetentionDays,
        notificationRetentionDays: this.cfg.notificationRetentionDays,
      });
    }
    return result;
  }
}
