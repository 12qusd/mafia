/**
 * Application wiring (BUILD_SPEC §4.2): Fastify HTTP + ws on the SAME port.
 *
 * Builds all services, registers HTTP routes, attaches the WS gateway to the
 * underlying HTTP server, and (if present) statically serves the built client
 * from ../client/dist with SPA fallback to index.html.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
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
import { registerAdminRoutes } from './http/admin-routes.js';
import { registerTestRoutes } from './http/test-routes.js';
import { BotManager, type BotLlmConfig } from './bots/manager.js';
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

  const ctx: GatewayContext = { cfg, store, identity, manager, moderation, telemetry, nameOf };

  // Capture names when identities are bound (the gateway calls onIdentityBound).
  const gateway = new Gateway(ctx);
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
  registerSetupRoutes(app, ctx);
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
    }
    gateway.closeAll();
    manager.disposeAll();
    await app.close();
    await store.close();
  };

  return { app, ctx, gateway, listen, shutdown };
}
