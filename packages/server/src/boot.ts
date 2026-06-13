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
  const onSignal = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('signal received; draining', { sig });
    built
      .shutdown(true)
      .then(() => {
        log.info('drain complete; exiting');
        process.exit(0);
      })
      .catch((err) => {
        log.error('shutdown error', { err: String(err) });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}
