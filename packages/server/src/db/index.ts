/**
 * Store factory (BUILD_SPEC §10). Chooses Postgres or the in-memory NO_DB store
 * based on config. The rest of the server depends only on the `Store` interface.
 */

import type { ServerConfig } from '../config.js';
import { log } from '../log.js';
import type { Store } from './types.js';
import { MemoryStore } from './memory-store.js';
import { PgStore } from './pg-store.js';

export function createStore(cfg: ServerConfig): Store {
  if (cfg.noDb || !cfg.databaseUrl) {
    if (!cfg.noDb && !cfg.databaseUrl) {
      log.warn('DATABASE_URL not set and NO_DB unset; defaulting to in-memory store');
    }
    return new MemoryStore();
  }
  log.info('using Postgres store');
  return PgStore.fromUrl(cfg.databaseUrl);
}

export type { Store } from './types.js';
export * from './types.js';
