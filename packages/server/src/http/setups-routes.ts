/**
 * Setup HTTP routes: custom setup builder + setup-of-the-day / chaos previews.
 *
 * Custom setups are validated server-side (`validateSetup`) BEFORE persistence
 * so a malformed setup can never reach engine init() via a lobby. The daily
 * feature is computed purely from the server's current date (allowed in the
 * server, not the engine/shared) via shared's `dailyFeature`/`chaosSetup`.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  GameSetupSchema,
  validateSetup,
  chaosSetup,
  dailyFeature,
  getSetup,
  DISPLAY_NAME_MAX,
} from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { readToken } from './auth-routes.js';

const CreateBody = z.object({
  name: z.string().min(1).max(DISPLAY_NAME_MAX),
  setup: GameSetupSchema,
});

/** Today's date as YYYY-MM-DD (server clock; not the engine/shared). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerSetupRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Per-user rate guard for setup creation (Task B); no-op in NO_DB/test.
  const setupCreateLimit = ctx.rateLimit({
    max: ctx.cfg.rateLimit.setupCreate,
    windowMs: ctx.cfg.rateLimit.windowMs,
  });

  // --- Custom setup builder ------------------------------------------------

  // Save a custom setup (authenticated, non-guest). Validated before insert.
  app.post('/api/setups/custom', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    if (setupCreateLimit(identity.id, reply)) return reply;

    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const validation = validateSetup(parsed.data.setup);
    if (!validation.ok) {
      return reply.code(400).send({ error: 'invalid_setup', errors: validation.errors });
    }

    const row = await ctx.store.createCustomSetup(identity.id, parsed.data.name, parsed.data.setup);
    return reply.send({ id: row.id });
  });

  // List the caller's saved setups.
  app.get('/api/setups/custom', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (!ctx.store.persistent) return reply.send({ setups: [] });
    const rows = await ctx.store.listCustomSetups(identity.id);
    return reply.send({
      setups: rows.map((r) => ({
        id: r.id,
        name: r.name,
        setup: r.setup,
        createdAt: r.createdAt,
      })),
    });
  });

  // Delete a custom setup (owner only).
  app.delete<{ Params: { id: string } }>('/api/setups/custom/:id', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(404).send({ error: 'not_found' });
    const ok = await ctx.store.deleteCustomSetup(req.params.id, identity.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ ok: true });
  });

  // --- Setup-of-the-day + chaos previews -----------------------------------

  // Today's featured shipped setup + a generated chaos preview (server date).
  app.get('/api/setups/daily', async (_req, reply) => {
    const day = today();
    const feature = dailyFeature(day);
    const featured = getSetup(feature.setupId);
    const chaos = chaosSetup(feature.chaosSeed);
    return reply.send({
      date: day,
      featured: featured ?? null,
      chaos: { id: chaos.id, seed: feature.chaosSeed, setup: chaos },
    });
  });

  // Generate a chaos setup preview. `seed` defaults to today's daily seed;
  // `players` (optional) pins a single count, else a 7..15 auto-scaling setup.
  app.get<{ Querystring: { seed?: string; players?: string } }>(
    '/api/setups/chaos',
    async (req, reply) => {
      const seed = req.query.seed && req.query.seed.length > 0 ? req.query.seed : dailyFeature(today()).chaosSeed;
      let players: number | undefined;
      if (req.query.players !== undefined) {
        const n = Number(req.query.players);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          return reply.code(400).send({ error: 'bad_request' });
        }
        players = n;
      }
      const setup = players === undefined ? chaosSetup(seed) : chaosSetup(seed, players);
      return reply.send({ id: setup.id, seed, setup });
    },
  );
}
