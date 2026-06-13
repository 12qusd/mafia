/**
 * Unconditional production entrypoint. Unlike index.ts (which only boots when
 * invoked directly, so tests can import it), this always starts the server —
 * required under process managers like pm2 whose fork-mode container makes
 * process.argv[1] point at the wrapper script instead of this file.
 */

import { main } from './boot.js';
import { log } from './log.js';

main().catch((err) => {
  log.error('fatal startup error', { err: String(err) });
  process.exit(1);
});
