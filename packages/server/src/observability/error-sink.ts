/**
 * Pluggable error observability sink (ops grab-bag, Task 7).
 *
 * A complete NO-OP unless `SENTRY_DSN` is configured. When it is, @sentry/node
 * is lazily imported + initialized ONCE at boot, and `reportError` forwards to
 * Sentry. Either way every caller still routes through `log.error` exactly as
 * before — Sentry is purely additive. The lazy import means the dependency has
 * zero runtime effect (and never even loads) when no DSN is present.
 */

import type { ServerConfig } from '../config.js';
import { log } from './../log.js';

/** Minimal shape we use from @sentry/node (kept tiny so the import stays lazy). */
interface SentryLike {
  init(opts: { dsn: string; environment?: string; release?: string }): void;
  captureException(err: unknown): void;
  flush(timeout?: number): Promise<boolean>;
}

let sentry: SentryLike | null = null;
let initialized = false;

/**
 * Initialize the error sink. Best-effort: a failed Sentry init never blocks
 * boot (the server keeps running with log.error-only reporting). Idempotent.
 */
export async function initErrorSink(cfg: ServerConfig): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!cfg.sentryDsn) return; // NO-OP path: no DSN ⇒ Sentry never loads.
  try {
    const mod = (await import('@sentry/node')) as unknown as SentryLike;
    mod.init({
      dsn: cfg.sentryDsn,
      environment: cfg.production ? 'production' : 'development',
      release: cfg.serverBuild,
    });
    sentry = mod;
    log.info('error observability: Sentry enabled');
  } catch (err) {
    // A broken @sentry/node must never wedge boot — fall back to log-only.
    log.warn('error observability: Sentry init failed; continuing log-only', {
      err: String(err),
    });
    sentry = null;
  }
}

/**
 * Report an error to the observability sink. Forwards to Sentry when enabled;
 * otherwise a no-op (the caller has already log.error'd). Never throws.
 */
export function reportError(err: unknown): void {
  if (!sentry) return;
  try {
    sentry.captureException(err);
  } catch {
    // Swallow: observability must never escalate into a new failure.
  }
}

/** Whether the Sentry sink is active (configured + initialized). */
export function errorSinkEnabled(): boolean {
  return sentry !== null;
}

/** Best-effort flush of pending events on shutdown. No-op when disabled. */
export async function flushErrorSink(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    /* ignore */
  }
}
