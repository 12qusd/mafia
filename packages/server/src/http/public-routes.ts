/**
 * Public HTTP routes (BUILD_SPEC §4.2, §7.3): health + public lobby list.
 */

import type { FastifyInstance } from 'fastify';
import { GAME_NAME, SETUPS, ACHIEVEMENTS, rankForMmr, PLACEMENT_GAMES } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { buildRankedSummary, RANKED_MODE } from '../ranked/award.js';
import { verifyFingerprint } from '../audit/fingerprint.js';
import { readToken } from './auth-routes.js';

/**
 * Match ids are uuids. A crawler hitting `/api/games/garbage/summary` is
 * definitionally "not found" — guarding here keeps Postgres from ever seeing an
 * invalid-uuid cast (clean 404 instead of a 500). Mirrors forum-routes.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Process start (epoch ms), captured at module load, for the /healthz uptime. */
const PROCESS_STARTED_AT = Date.now();

export function registerPublicRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Health endpoint (§4.2) + observability depth (deferred-tail wave).
  //
  // The bare `/healthz` stays a CHEAP liveness check (no DB round-trip): the
  // original fields (ok, game, draining, persistent) for backward-compat, plus
  // process uptime + serverBuild (both free, non-sensitive). The heavier DB
  // readiness probe is gated behind `?deep=1`: `/healthz?deep=1` adds a `db`
  // block with the pg Pool stats from store.poolStats(). The DB probe is
  // best-effort — a failure surfaces as `db.ok:false`, it NEVER throws/500s the
  // endpoint — and a non-persistent (NO_DB) store reports `db:null`. No secrets
  // or connection strings are ever exposed.
  app.get<{ Querystring: { deep?: string } }>('/healthz', async (req) => {
    const base = {
      ok: true,
      game: GAME_NAME,
      draining: ctx.manager.isDraining,
      persistent: ctx.store.persistent,
      uptimeSec: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
      serverBuild: ctx.cfg.serverBuild,
    };
    if (req.query.deep !== '1') return base;
    // Deep/readiness probe: best-effort DB pool stats. poolStats() already
    // swallows its own query failure (ok:false); guard anyway so a thrown
    // rejection can never 500 the health endpoint.
    let db: { ok: boolean; total: number; idle: number; waiting: number } | null = null;
    try {
      db = await ctx.store.poolStats();
    } catch {
      db = { ok: false, total: 0, idle: 0, waiting: 0 };
    }
    return { ...base, db };
  });

  // --- Retention front-end: public social proof + shareable summaries ------
  // All three are no-auth and leak-safe: the recent list and the summary expose
  // ONLY finished matches (the store filters ended_at NOT NULL), and online is a
  // bare connection count. They degrade to empty/zero under NO_DB.

  // Live "souls around" count for the home-page social-proof strip. Cheap.
  app.get('/api/stats/online', async () => ({ online: ctx.onlineCount?.() ?? 0 }));

  // "Fresh off the table" — recent FINISHED matches (newest first). Default 8,
  // capped at 30. Empty list under NO_DB (no persisted matches) or on no data.
  app.get<{ Querystring: { limit?: string } }>('/api/games/recent', async (req, reply) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 8, 30));
    const games = await ctx.store.getRecentMatches(limit);
    return reply.send({ games });
  });

  // Public, no-auth match summary (the shareable replay card). 404 for a
  // non-uuid, an unknown id, OR an in-progress match (the store returns null
  // unless ended_at is set — an in-progress game's roles must never leak).
  app.get<{ Params: { matchId: string } }>('/api/games/:matchId/summary', async (req, reply) => {
    if (!UUID_RE.test(req.params.matchId)) return reply.code(404).send({ error: 'not_found' });
    const summary = await ctx.store.getPublicMatchSummary(req.params.matchId);
    if (!summary) return reply.code(404).send({ error: 'not_found' });
    return reply.send(summary);
  });

  // Public lobby browser data (§7.3).
  app.get('/api/lobbies', async () => ({ lobbies: ctx.manager.publicLobbyList() }));

  // Setup catalog (lobby creation picker). Shipped setups carry `chaos: false`;
  // chaos setups are generated on demand via /api/setups/chaos and /api/setups/daily.
  app.get('/api/setups', async () => ({
    setups: SETUPS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      minPlayers: s.minPlayers,
      maxPlayers: s.maxPlayers,
      chaos: false,
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

  // --- Ranked play (MMR leaderboard + per-user rank + seasons) -------------

  // Season archive: every season (id, name, started/ended, isCurrent), newest
  // first. Drives the leaderboard's season filter dropdown. Empty under NO_DB.
  app.get<{ Querystring: { limit?: string } }>('/api/seasons', async (req, reply) => {
    if (!ctx.store.persistent) return reply.send({ seasons: [] });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 24, 100));
    const seasons = await ctx.store.getSeasons(limit);
    return reply.send({ seasons });
  });

  // Ranked leaderboard: top MMR for a season (defaults to the current) + ranked
  // mode, PAGINATED. Each entry carries the derived rank (key/name) so the client
  // renders the ladder badge; unplaced players (games < PLACEMENT_GAMES) are
  // flagged so the client can show the placements pill instead of the ladder.
  app.get<{ Querystring: { limit?: string; page?: string; seasonId?: string } }>(
    '/api/leaderboard/ranked',
    async (req, reply) => {
      const seasonId = req.query.seasonId || ctx.manager.seasonId;
      if (!ctx.store.persistent || !seasonId) {
        return reply.send({
          entries: [],
          seasonId: seasonId ?? null,
          page: 0,
          limit: 0,
          total: 0,
        });
      }
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
      const page = Math.max(0, Number(req.query.page) || 0);
      const [rows, total] = await Promise.all([
        ctx.store.getRatingLeaderboardPage(RANKED_MODE, seasonId, page * limit, limit),
        ctx.store.getRatingCount(RANKED_MODE, seasonId),
      ]);
      const entries = rows.map((r, i) => {
        const rank = rankForMmr(r.mmr);
        const unplaced = r.games < PLACEMENT_GAMES;
        return {
          // Absolute board position (1-based) for this page.
          position: page * limit + i + 1,
          userId: r.userId,
          username: r.username,
          mmr: Math.round(r.mmr),
          rd: Math.round(r.rd),
          rank: rank.key,
          rankName: rank.name,
          games: r.games,
          wins: r.wins,
          // Unplaced players appear on the board but are marked so the client
          // shows "Unranked — X/5 placements" in place of the ladder badge.
          ...(unplaced ? { placements: { played: r.games, total: PLACEMENT_GAMES } } : {}),
        };
      });
      return reply.send({ entries, seasonId, page, limit, total });
    },
  );

  // Public ranked standing for a user (current season). 404 when none.
  app.get<{ Params: { userId: string } }>('/api/rank/:userId', async (req, reply) => {
    const seasonId = ctx.manager.seasonId;
    if (!ctx.store.persistent || !seasonId) return reply.code(404).send({ error: 'not_found' });
    const ranked = await buildRankedSummary(ctx.store, req.params.userId, seasonId);
    if (!ranked) return reply.code(404).send({ error: 'not_found' });
    return reply.send(ranked);
  });

  // --- Replay export (goal 9) ----------------------------------------------
  // Downloadable, server-fingerprinted replay. Only participants of the match
  // or an admin may fetch it; verify-on-read attaches an integrity verdict.
  app.get<{ Params: { matchId: string } }>('/api/matches/:matchId/replay', async (req, reply) => {
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
  });
}
