/**
 * Shared boot logic (BUILD_SPEC §4.2, §13.4).
 *
 * Boots the app and wires graceful drain: SIGTERM ⇒ stop accepting new lobbies,
 * let running games finish (max DRAIN_MAX_MS / 60 min), then exit.
 */

import { loadConfig, hotReloadConfig } from './config.js';
import { buildApp } from './app.js';
import { log } from './log.js';
import { initErrorSink, reportError, flushErrorSink } from './observability/error-sink.js';

export async function main(): Promise<void> {
  const cfg = loadConfig();
  // Error observability (Task 7): a NO-OP unless SENTRY_DSN is set. Initialized
  // before the crash handlers below so they can report through it; log.error
  // remains the primary, always-on path.
  await initErrorSink(cfg);
  const built = await buildApp(cfg);
  await built.listen();

  let shuttingDown = false;
  const drainAndExit = (code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    built
      .shutdown(true)
      .then(() => flushErrorSink())
      .then(() => {
        log.info('drain complete; exiting', { code });
        process.exit(code);
      })
      .catch((err) => {
        log.error('shutdown error', { err: String(err) });
        process.exit(code || 1);
      });
  };

  const onSignal = (sig: string) => {
    log.info('signal received; draining', { sig });
    drainAndExit(0);
  };

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  // SIGHUP — minimal, safe hot-reload (horizontal-scaling ops). Re-reads only
  // the cheap knobs that are consumed live (per-route rate limits + retention /
  // instance-stale windows) and MUTATES the running cfg in place; connections +
  // in-flight games are entirely undisturbed (NO listener/store/gateway rebuild,
  // NO restart, NO drain — distinct from the SIGTERM/SIGINT path above). Settings
  // that cannot be hot-swapped (PORT/HOST/DATABASE_URL/SESSION_SECRET/the timer
  // intervals) are logged as needing a restart. Best-effort: never throws.
  process.on('SIGHUP', () => {
    try {
      const result = hotReloadConfig(cfg);
      log.info('config reload (SIGHUP)', {
        rateLimit: result.applied.rateLimit,
        chatRetentionDays: result.applied.chatRetentionDays,
        notificationRetentionDays: result.applied.notificationRetentionDays,
        instanceStaleMs: result.applied.instanceStaleMs,
        ...(result.restartRequired.length > 0
          ? { restartRequiredFor: result.restartRequired }
          : {}),
      });
      if (result.restartRequired.length > 0) {
        log.warn('config reload: some settings need a full restart to apply', {
          settings: result.restartRequired,
        });
      }
    } catch (err) {
      log.warn('config reload (SIGHUP) failed', { err: String(err) });
    }
  });

  // Crash-safety (Task D). A rejected promise nobody awaited is logged
  // structured but does NOT kill the process (it may be a benign background
  // best-effort task). An uncaughtException is unsafe to continue from: log it,
  // attempt a best-effort graceful drain, then exit non-zero so pm2 restarts the
  // process cleanly rather than leaving it wedged.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', {
      err: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    });
    reportError(reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException; shutting down', { err: err.stack ?? err.message });
    reportError(err);
    drainAndExit(1);
    // Safety net: if graceful drain hangs, force-exit so pm2 can restart us.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
