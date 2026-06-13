/**
 * Server entrypoint (BUILD_SPEC §4.2, §13.4).
 *
 * Boot logic lives in boot.ts; production process managers should use
 * start.js, which boots unconditionally. This module only boots when invoked
 * directly (`node dist/index.js`) so tests can import buildApp safely.
 */

import { main } from './boot.js';
import { log } from './log.js';

export { buildApp } from './app.js';
export { loadConfig } from './config.js';
export { main } from './boot.js';

// Run only when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('index.js');
if (invokedDirectly) {
  main().catch((err) => {
    log.error('fatal startup error', { err: String(err) });
    process.exit(1);
  });
}
