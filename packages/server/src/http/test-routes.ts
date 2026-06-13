/**
 * TEST-MODE HTTP routes (NOCTURNE test mode).
 *
 * `GET /api/test/match/:roomId/audit` — downloadable full-match audit JSON for a
 * TEST room: setup, seed, action log, all resolution traces, per-seat private
 * result history. This is evidence for engine disputes + fixtures for new-role
 * golden tests. Access is gated: the requester must be the test lobby's host
 * (the god audience) OR an admin (x-admin-token / admin account). Non-test rooms
 * always 404 — these frames never exist for normal games (§5).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { GatewayContext } from '../ws/context.js';
import { readToken } from './auth-routes.js';

async function isAdmin(ctx: GatewayContext, req: FastifyRequest): Promise<boolean> {
  const headerToken = req.headers['x-admin-token'];
  if (ctx.cfg.adminToken && headerToken === ctx.cfg.adminToken) return true;
  const identity = await ctx.identity.resolveToken(readToken(req));
  return identity?.isAdmin === true;
}

export function registerTestRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/api/test/match/:roomId/audit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { roomId } = req.params as { roomId: string };
    const room = ctx.manager.getRoom(roomId);
    // Test rooms only — a non-test or unknown room is indistinguishable (404).
    if (!room || !room.isTestMode) {
      return reply.code(404).send({ error: 'not_found' });
    }
    // Auth: admin OR the test lobby's host (god audience).
    const identity = await ctx.identity.resolveToken(readToken(req));
    const isHost = identity?.id === room.godIdentityId;
    if (!isHost && !(await isAdmin(ctx, req))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.send(room.buildAudit());
  });
}
