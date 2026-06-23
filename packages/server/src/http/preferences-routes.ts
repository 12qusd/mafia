/**
 * Role-preference HTTP routes (point-unlocked, goal 3). Account-only.
 *
 *   GET  /api/me/preferences  → { unlocks, preferences }
 *   POST /api/preferences     { role, preference: 'blacklist'|'prefer'|null }
 *
 * The unlock GATE is enforced server-side on write: a player may store a
 * `blacklist` entry only once their lifetime points reach `ROLE_BLACKLIST_AT`
 * and a `prefer` entry only at `ROLE_PREFER_AT` (read from `user_stats`). A write
 * for a tier the player has not unlocked is rejected 403 — the client gate is a
 * convenience, not the authority. (Assignment-time gating in the lobby manager is
 * a second, independent enforcement, so stale prefs are also ignored at deal.)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RoleIdSchema, unlocksFor } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { readToken } from './auth-routes.js';

const SetBody = z.object({
  role: RoleIdSchema,
  preference: z.enum(['blacklist', 'prefer']).nullable(),
});

export function registerPreferencesRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // Read the caller's role preferences + their current unlock state.
  app.get('/api/me/preferences', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) {
      return reply.send({ unlocks: unlocksFor(0), preferences: [] });
    }
    const [prefs, stats] = await Promise.all([
      ctx.store.getRolePreferences(identity.id),
      ctx.store.getUserStats(identity.id),
    ]);
    const totalPoints = stats?.totalPoints ?? 0;
    return reply.send({ unlocks: unlocksFor(totalPoints), preferences: prefs });
  });

  // Set or clear (preference=null) a role preference. Gated on the unlock tier.
  app.post('/api/preferences', async (req, reply) => {
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity) return reply.code(401).send({ error: 'not_authenticated' });
    if (identity.isGuest) return reply.code(403).send({ error: 'forbidden' });
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });

    const parsed = SetBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const { role, preference } = parsed.data;

    // Enforce the unlock gate on writes. Clearing (null) is always allowed (a
    // player who lost a tier can still remove a stale preference).
    if (preference !== null) {
      const stats = await ctx.store.getUserStats(identity.id);
      const { canBlacklistRoles, canPreferRoles } = unlocksFor(stats?.totalPoints ?? 0);
      if (preference === 'blacklist' && !canBlacklistRoles) {
        return reply.code(403).send({ error: 'locked', unlock: 'blacklist' });
      }
      if (preference === 'prefer' && !canPreferRoles) {
        return reply.code(403).send({ error: 'locked', unlock: 'prefer' });
      }
    }

    await ctx.store.setRolePreference(identity.id, role, preference);
    return reply.send({ ok: true });
  });
}
