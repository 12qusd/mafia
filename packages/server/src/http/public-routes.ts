/**
 * Public HTTP routes (BUILD_SPEC §4.2, §7.3): health + public lobby list.
 */

import type { FastifyInstance } from 'fastify';
import { GAME_NAME, SETUPS, ACHIEVEMENTS } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { verifyFingerprint } from '../audit/fingerprint.js';
import { readToken } from './auth-routes.js';

export function registerPublicRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Health endpoint (§4.2).
  app.get('/healthz', async () => ({
    ok: true,
    game: GAME_NAME,
    draining: ctx.manager.isDraining,
    persistent: ctx.store.persistent,
  }));

  // Public lobby browser data (§7.3).
  app.get('/api/lobbies', async () => ({ lobbies: ctx.manager.publicLobbyList() }));

  // Setup catalog (lobby creation picker).
  app.get('/api/setups', async () => ({
    setups: SETUPS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      minPlayers: s.minPlayers,
      maxPlayers: s.maxPlayers,
    })),
  }));

  // Achievement catalog (profile rendering).
  app.get('/api/achievements', async () => ({ achievements: ACHIEVEMENTS }));

  // --- Points & progression (goal 4) ---------------------------------------

  // Public profile stats for a registered user.
  app.get<{ Params: { userId: string } }>('/api/stats/:userId', async (req, reply) => {
    if (!ctx.store.persistent) return reply.code(404).send({ error: 'not_found' });
    const summary = await buildUserStatsSummary(ctx.store, req.params.userId);
    if (!summary) return reply.code(404).send({ error: 'not_found' });
    return reply.send(summary);
  });

  // Global leaderboard (top players by points).
  app.get<{ Querystring: { limit?: string } }>('/api/leaderboard', async (req, reply) => {
    if (!ctx.store.persistent) return reply.send({ entries: [] });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const entries = await ctx.store.getLeaderboard(limit);
    return reply.send({ entries });
  });

  // --- Replay export (goal 9) ----------------------------------------------
  // Downloadable, server-fingerprinted replay. Only participants of the match
  // or an admin may fetch it; verify-on-read attaches an integrity verdict.
  app.get<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/replay',
    async (req, reply) => {
      if (!ctx.store.persistent) return reply.code(404).send({ error: 'not_found' });
      const identity = await ctx.identity.resolveToken(readToken(req));
      if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
      const matchId = req.params.matchId;
      const participants = await ctx.store.getMatchParticipants(matchId);
      if (participants.length === 0) return reply.code(404).send({ error: 'not_found' });
      const authorized = identity.isAdmin || participants.includes(identity.id);
      if (!authorized) return reply.code(403).send({ error: 'forbidden' });

      const replay = await ctx.store.getMatchReplay(matchId);
      if (!replay) return reply.code(404).send({ error: 'not_found' });

      const verified = verifyFingerprint(
        {
          id: replay.id,
          setupId: replay.setupId,
          seed: replay.seed,
          outcome: replay.outcome,
          players: replay.players,
          events: replay.events,
          chat: replay.chat,
        },
        ctx.cfg.sessionSecret,
        replay.fingerprint,
      );

      reply.header('content-disposition', `attachment; filename="nocturne-replay-${matchId}.json"`);
      return reply.send({
        schemaVersion: 1,
        game: GAME_NAME,
        serverBuild: replay.serverBuild,
        integrity: { fingerprint: replay.fingerprint, verified },
        match: replay,
      });
    },
  );
}
