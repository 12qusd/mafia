/**
 * Application wiring (BUILD_SPEC §4.2): Fastify HTTP + ws on the SAME port.
 *
 * Builds all services, registers HTTP routes, attaches the WS gateway to the
 * underlying HTTP server, and (if present) statically serves the built client
 * from ../client/dist with SPA fallback to index.html.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { ServerConfig } from './config.js';
import { createStore } from './db/index.js';
import { IdentityService } from './auth/identity.js';
import { LobbyManager } from './lobby/manager.js';
import { Moderation } from './moderation/moderation.js';
import { Telemetry } from './telemetry.js';
import { getEngine, isUsingFallbackEngine } from './engine-adapter.js';
import { Gateway } from './ws/gateway.js';
import type { GatewayContext } from './ws/context.js';
import { registerAuthRoutes } from './http/auth-routes.js';
import { registerPublicRoutes } from './http/public-routes.js';
import { registerSetupRoutes } from './http/setups-routes.js';
import { registerPreferencesRoutes } from './http/preferences-routes.js';
import { registerSocialRoutes } from './http/social-routes.js';
import { registerForumRoutes } from './http/forum-routes.js';
import { registerShareRoutes } from './http/share-routes.js';
import { registerAdminRoutes } from './http/admin-routes.js';
import { registerTestRoutes } from './http/test-routes.js';
import { makeRateLimiter } from './http/rate-limit.js';
import { makeEmailTransport } from './email/transport.js';
import { EmailService } from './email/service.js';
import { registerAccountRoutes } from './http/account-routes.js';
import { BotManager, type BotLlmConfig } from './bots/manager.js';
import { reportError } from './observability/error-sink.js';
import { log } from './log.js';

export interface BuiltApp {
  app: FastifyInstance;
  ctx: GatewayContext;
  gateway: Gateway;
  listen: () => Promise<void>;
  shutdown: (graceful: boolean) => Promise<void>;
}

export async function buildApp(cfg: ServerConfig): Promise<BuiltApp> {
  const store = createStore(cfg);

  // Fail fast if the configured DB is unreachable, rather than booting "healthy"
  // against a dead Postgres (Task D). No-op for the in-memory store.
  if (store.persistent) {
    try {
      await store.healthCheck();
    } catch (err) {
      log.error('database health check failed at boot; refusing to start', {
        err: String(err),
      });
      await store.close().catch(() => {});
      throw new Error(`database unreachable: ${String(err)}`);
    }
  }

  // Admin-token boot warning (ops polish): a weak/absent ADMIN_TOKEN must never
  // pass silently — the admin endpoints + god-powers gate on it. Warn (loudly in
  // production) when it is unset, too short, or an obvious default placeholder.
  warnOnWeakAdminToken(cfg.adminToken, cfg.production);

  // TEST MODE in production is a deliberate owner-QA escape hatch, but it must
  // never be silently on: any test/audit/debug surface it opens is now admin-
  // gated (Task A), yet a loud boot warning keeps the operator aware of it.
  if (cfg.testModeEnv && (store.persistent || cfg.production)) {
    log.warn(
      'NOCTURNE_TEST_MODE is ENABLED in a production/persistent deployment — ' +
        'test-lobby creation and test/audit endpoints are admin-only; disable the flag if not actively running QA',
      { production: cfg.production, persistent: store.persistent },
    );
  }

  const engine = await getEngine();
  if (isUsingFallbackEngine()) {
    log.warn('using the in-server reference engine (real @nocturne/engine not detected)');
  }

  const identity = new IdentityService(store, cfg);
  const moderation = new Moderation(store);
  const telemetry = new Telemetry(store);

  // Name resolution: room/lobby keep names; this is a best-effort lookup used
  // by lobby DTOs. Names are captured at join/start; for ids we don't know we
  // fall back to a short id-derived handle.
  const nameRegistry = new Map<string, string>();
  const nameOf = (id: string): string => nameRegistry.get(id) ?? id.slice(0, 8);

  // TEST MODE bot backfill (§12.2). Connects in-process bots over loopback WS to
  // this same server; resolved ws URL is read lazily after listen().
  let boundWsUrl: string | null = null;
  const llmConfig: BotLlmConfig | null = cfg.llmBaseUrl
    ? {
        baseUrl: cfg.llmBaseUrl,
        model: cfg.llmModel,
        ...(cfg.llmApiKey ? { apiKey: cfg.llmApiKey } : {}),
        timeoutMs: cfg.llmTimeoutMs,
        maxConcurrency: cfg.llmMaxConcurrency,
      }
    : null;
  const botManager = new BotManager({
    wsUrl: () => boundWsUrl,
    llm: llmConfig,
  });

  const manager = new LobbyManager({
    engine,
    store,
    telemetry,
    serverBuild: cfg.serverBuild,
    nameOf,
    testModeEnv: cfg.testModeEnv,
    bots: botManager,
    fingerprintSecret: cfg.sessionSecret,
    // Quick-play matchmaker sprinkles a few LLM bots only when an LLM is wired.
    llmAvailable: llmConfig !== null,
  });

  // Ranked play: ensure exactly one current season exists and cache its id so
  // ranked matches + MMR are season-scoped. A no-op without a persistent store
  // (ranked requires accounts). Season rollover/soft-reset is a documented stub.
  await manager.ensureSeason('Season 1');

  // HTTP rate limiting (Task B): enabled only for a persistent store, so the
  // NO_DB test suite (which hammers auth/account endpoints) is never throttled.
  const rateLimit = makeRateLimiter(store.persistent);

  // Account-lifecycle email: SMTP when configured, else a log transport (so the
  // reset/verify/welcome flows are fully functional in dev/unconfigured prod).
  const email = new EmailService(makeEmailTransport(cfg.email), cfg);

  const ctx: GatewayContext = {
    cfg,
    store,
    identity,
    manager,
    moderation,
    telemetry,
    nameOf,
    rateLimit,
    email,
  };

  // Capture names when identities are bound (the gateway calls onIdentityBound).
  const gateway = new Gateway(ctx);
  // Expose the live socket count to public routes (social-proof strip). Set
  // after the gateway exists so /api/stats/online reflects real connections.
  ctx.onlineCount = () => gateway.connectionCount();
  // Wrap nameOf registration: the IdentityService knows guest names; accounts'
  // names come from the user row. We register on resolveToken via a hook below.
  const origResolve = identity.resolveToken.bind(identity);
  identity.resolveToken = async (token) => {
    const res = await origResolve(token);
    if (res) nameRegistry.set(res.id, res.name);
    return res;
  };
  const origGuest = identity.createGuest.bind(identity);
  identity.createGuest = () => {
    const g = origGuest();
    nameRegistry.set(g.identity.id, g.identity.name);
    return g;
  };

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  // Error observability (Task 7): forward unhandled route errors to the error
  // sink (a NO-OP unless SENTRY_DSN is set) AND log them, then preserve Fastify's
  // default 5xx behaviour. Validation/4xx errors (statusCode < 500) are client
  // errors — logged at debug only and NOT reported, to avoid noise.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      log.error('request error', { method: req.method, url: req.url, err: err.stack ?? err.message });
      reportError(err);
    }
    // Never echo internal exception text to clients: 5xx → 'internal_error',
    // 4xx → a stable 'bad_request' code (matches the explicit-route convention).
    // The framework's own error code (e.g. FST_ERR_*) is preserved for the client
    // to branch on without leaking a raw message.
    reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'bad_request',
      ...(err.code ? { code: err.code } : {}),
    });
  });
  await app.register(fastifyCookie);
  // Form bodies for the admin sanction form.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        done(null, Object.fromEntries(params.entries()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  registerPublicRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerSetupRoutes(app, ctx);
  registerPreferencesRoutes(app, ctx);
  registerSocialRoutes(app, ctx);
  registerForumRoutes(app, ctx);
  // OG/preview meta injection for /replay/:id, /u/:username, /join/:code. These
  // explicit GETs serve the SPA shell with a link-preview card injected, taking
  // precedence over the static wildcard + SPA fallback for exactly those paths.
  // No-op when the built client (index.html) is absent.
  registerShareRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerTestRoutes(app, ctx);

  // Static client (§4.2): serve ../client/dist with SPA fallback if it exists.
  const distDir = resolve(process.cwd(), cfg.clientDistDir);
  const clientPresent = existsSync(distDir);
  if (clientPresent) {
    // wildcard:true serves files dynamically per request, so a client rebuild
    // (new hashed asset names) is picked up without restarting the server. With
    // wildcard:false @fastify/static globs the dir once at startup and only
    // knows the asset names that existed then — stale after any rebuild.
    await app.register(fastifyStatic, { root: distDir, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      // API/WS/admin 404s stay 404; everything else falls back to index.html.
      if (
        req.url.startsWith('/api') ||
        req.url.startsWith('/ws') ||
        req.url.startsWith('/admin') ||
        req.url.startsWith('/healthz')
      ) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
    log.info('serving static client', { dir: distDir });
  } else {
    log.info('no built client found; API/WS only', { dir: distDir });
  }

  await app.ready();
  gateway.attach(app.server);
  telemetry.startRollups();

  const listen = async (): Promise<void> => {
    await app.listen({ port: cfg.port, host: cfg.host });
    // Resolve the actual bound port so in-process test bots can connect over
    // genuine loopback WebSockets (port 0 ⇒ OS-assigned).
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
    boundWsUrl = `ws://127.0.0.1:${port}/ws`;
    log.info('server listening', { port: cfg.port, host: cfg.host, noDb: cfg.noDb });
  };

  const shutdown = async (graceful: boolean): Promise<void> => {
    telemetry.stopRollups();
    await telemetry.flush().catch(() => {});
    if (graceful) {
      manager.startDrain();
      const deadline = Date.now() + cfg.drainMaxMs;
      while (manager.activeRooms() > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      // If the drain deadline elapsed with games still running, we are about to
      // ABANDON them — say so loudly (with the count) rather than exiting quietly,
      // so the operator knows in-progress matches were dropped on this shutdown.
      const remaining = manager.activeRooms();
      if (remaining > 0) {
        log.warn('drain deadline reached with active games still running; abandoning them', {
          activeRooms: remaining,
          drainMaxMs: cfg.drainMaxMs,
        });
      } else {
        log.info('drain complete; no active games remaining');
      }
    }
    gateway.closeAll();
    manager.disposeAll();
    await app.close();
    await store.close();
  };

  return { app, ctx, gateway, listen, shutdown };
}

/** Obvious placeholder/default admin tokens that must never guard a real deploy. */
const WEAK_ADMIN_TOKENS = new Set([
  'admin',
  'changeme',
  'change-me',
  'secret',
  'password',
  'token',
  'admin-token',
  'dev',
  'test',
  'nocturne',
]);

/**
 * Warn at boot when the admin token is unset, suspiciously short (<24 chars), or
 * an obvious default — so a weak admin gate never passes silently. Pure: takes
 * the value + production flag, emits a single structured log.warn. Never throws.
 */
function warnOnWeakAdminToken(token: string | undefined, production: boolean): void {
  let reason: string | null = null;
  if (!token) reason = 'unset';
  else if (token.length < 24) reason = 'too_short';
  else if (WEAK_ADMIN_TOKENS.has(token.toLowerCase())) reason = 'default_value';
  if (!reason) return;
  log.warn(
    'ADMIN_TOKEN is weak or unset — admin endpoints + god-powers are guarded by it; ' +
      'set a long, random ADMIN_TOKEN before exposing this server',
    { reason, production },
  );
}
