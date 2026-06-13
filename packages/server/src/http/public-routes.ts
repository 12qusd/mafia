/**
 * Public HTTP routes (BUILD_SPEC §4.2, §7.3): health + public lobby list.
 */

import type { FastifyInstance } from 'fastify';
import { GAME_NAME, SETUPS } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';

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
}
