/**
 * Tiny migration runner (BUILD_SPEC §10). Applies `schema.sql` idempotently
 * (every statement is `IF NOT EXISTS`). Run via:
 *
 *   pnpm --filter @nocturne/server migrate
 *
 * Requires DATABASE_URL. No-ops with a warning under NO_DB=1.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../config.js';
import { log } from '../log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(databaseUrl: string): Promise<void> {
  // schema.sql is copied next to the compiled migrate.js by the build (see
  // tsconfig / build note); fall back to the src path for ts-node style runs.
  let sql: string;
  try {
    sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  } catch {
    sql = readFileSync(join(__dirname, '../../src/db/schema.sql'), 'utf8');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(sql);
    log.info('migration applied');
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.noDb) {
    log.warn('NO_DB=1 set; skipping migration');
    return;
  }
  if (!cfg.databaseUrl) {
    log.error('DATABASE_URL is required to migrate');
    process.exitCode = 1;
    return;
  }
  await migrate(cfg.databaseUrl);
}

// Run when invoked directly (node dist/db/migrate.js).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('migrate.js');
if (invokedDirectly) {
  main().catch((err) => {
    log.error('migration failed', { err: String(err) });
    process.exitCode = 1;
  });
}
