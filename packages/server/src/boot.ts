/**
 * Shared boot logic (BUILD_SPEC §4.2, §13.4).
 *
 * Boots the app and wires graceful drain: SIGTERM ⇒ stop accepting new lobbies,
 * let running games finish (max DRAIN_MAX_MS / 60 min), then exit.
 */

import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { log } from './log.js';

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const built = await buildApp(cfg);
  await built.listen();

  let shuttingDown = false;
  const drainAndExit = (code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    built
      .shutdown(true)
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

  // Crash-safety (Task D). A rejected promise nobody awaited is logged
  // structured but does NOT kill the process (it may be a benign background
  // best-effort task). An uncaughtException is unsafe to continue from: log it,
  // attempt a best-effort graceful drain, then exit non-zero so pm2 restarts the
  // process cleanly rather than leaving it wedged.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', {
      err: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException; shutting down', { err: err.stack ?? err.message });
    drainAndExit(1);
    // Safety net: if graceful drain hangs, force-exit so pm2 can restart us.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
