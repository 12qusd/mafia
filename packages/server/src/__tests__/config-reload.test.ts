/**
 * SIGHUP hot-reload (hotReloadConfig) checks.
 *
 * The reload re-reads the cheap, live-consumed knobs (per-route rate limits +
 * retention / instance-stale windows) and MUTATES the running cfg in place;
 * structural settings that cannot be hot-swapped are reported in
 * `restartRequired`. It must never throw and must not disturb anything else on
 * the config object.
 *
 * NOTE: loadConfig reads numeric knobs from process.env (string knobs honor the
 * passed env object). In production SIGHUP fires AFTER the operator edits the
 * real env, so these tests drive process.env (restored afterEach) to mirror
 * that exactly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, hotReloadConfig } from '../config.js';

const SAVED = { ...process.env };
afterEach(() => {
  // Restore process.env to its pre-test state (delete keys we added).
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

describe('hotReloadConfig', () => {
  it('hot-swaps the live rate limits + retention windows in place', () => {
    process.env.NO_DB = '1';
    const cfg = loadConfig();

    process.env.RATE_LIMIT_LOGIN = '99';
    process.env.RATE_LIMIT_WINDOW_MS = '12345';
    process.env.CHAT_RETENTION_DAYS = '7';
    process.env.NOTIFICATION_RETENTION_DAYS = '3';
    process.env.INSTANCE_STALE_MS = '45000';

    const result = hotReloadConfig(cfg);

    // Mutated in place — the same object a route/sweep reads live.
    expect(cfg.rateLimit.login).toBe(99);
    expect(cfg.rateLimit.windowMs).toBe(12345);
    expect(cfg.maintenance.chatRetentionDays).toBe(7);
    expect(cfg.maintenance.notificationRetentionDays).toBe(3);
    expect(cfg.maintenance.instanceStaleMs).toBe(45000);

    // Reported applied values mirror the mutation.
    expect(result.applied.rateLimit.login).toBe(99);
    expect(result.applied.chatRetentionDays).toBe(7);
    expect(result.restartRequired).toEqual([]);
  });

  it('reports structural changes as restart-required (and does NOT apply them)', () => {
    process.env.NO_DB = '1';
    process.env.PORT = '8080';
    const cfg = loadConfig();

    process.env.PORT = '9090';
    process.env.DATABASE_URL = 'postgres://x';
    process.env.MAINTENANCE_INTERVAL_MS = '1000';
    process.env.INSTANCE_HEARTBEAT_MS = '5000';

    const result = hotReloadConfig(cfg);

    // Structural settings are NOT hot-applied — the live cfg keeps booting values.
    expect(cfg.port).toBe(8080);
    expect(result.restartRequired).toEqual(
      expect.arrayContaining([
        'PORT',
        'DATABASE_URL',
        'MAINTENANCE_INTERVAL_MS',
        'INSTANCE_HEARTBEAT_MS',
      ]),
    );
  });

  it('a no-change reload is a clean no-op (empty restartRequired, never throws)', () => {
    process.env.NO_DB = '1';
    const cfg = loadConfig();
    const before = JSON.stringify(cfg.rateLimit);
    const result = hotReloadConfig(cfg);
    expect(result.restartRequired).toEqual([]);
    expect(JSON.stringify(cfg.rateLimit)).toBe(before);
  });
});
