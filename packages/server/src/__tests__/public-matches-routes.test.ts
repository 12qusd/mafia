/**
 * Route-level checks for the retention front-end public endpoints + the OG/share
 * HTML injection, over the NO_DB (guests-only) test context.
 *
 * Covers: the online-count shape; the recent-games degrade-to-empty under NO_DB;
 * the summary 404 for unknown/non-uuid ids; and the share routes serving the SPA
 * shell with an injected, HTML-escaped <title>/og:title (and never a 500 for an
 * unknown user).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { registerPublicRoutes } from '../http/public-routes.js';
import { registerShareRoutes } from '../http/share-routes.js';

const A_UUID = '11111111-1111-1111-1111-111111111111';

/** A minimal SPA shell with a </head> for the share routes to inject into. */
function writeShell(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nocturne-share-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>Nocturne</title></head><body><div id="root"></div></body></html>',
  );
  return dir;
}

async function buildApp() {
  const { ctx, store } = buildTestContext();
  // Point the share routes at a temp shell so they register regardless of
  // whether the real client has been built. Stub onlineCount like app.ts does.
  ctx.cfg = { ...ctx.cfg, clientDistDir: writeShell() };
  ctx.onlineCount = () => 3;
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerPublicRoutes(app, ctx);
  registerShareRoutes(app, ctx);
  await app.ready();
  return { app, ctx, store };
}

describe('GET /api/stats/online', () => {
  it('returns the live count shape', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ online: 3 });
    await app.close();
  });

  it('defaults to 0 when onlineCount is absent', async () => {
    const { ctx } = buildTestContext();
    delete ctx.onlineCount;
    const app = Fastify({ logger: false });
    registerPublicRoutes(app, ctx);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/stats/online' });
    expect(res.json()).toEqual({ online: 0 });
    await app.close();
  });
});

describe('GET /api/games/recent', () => {
  it('returns { games: [] } under NO_DB (no persisted matches)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/games/recent' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ games: [] });
    await app.close();
  });

  it('reflects finished matches written to the store (and caps the limit)', async () => {
    const { app, store } = await buildApp();
    await store.writeMatch({
      id: A_UUID,
      setupId: 'classic',
      config: {},
      seed: 's',
      startedAt: 1,
      endedAt: 2,
      outcome: 'TOWN',
      serverBuild: 'test',
      fingerprint: 'fp',
      mode: 'casual',
      players: [
        { userOrGuestId: 'g1', seat: 0, role: 'SHERIFF', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null },
      ],
      events: [],
      chat: [],
    });
    const res = await app.inject({ method: 'GET', url: '/api/games/recent?limit=999' });
    const body = res.json() as { games: Array<{ id: string; players: number }> };
    expect(body.games).toHaveLength(1);
    expect(body.games[0]!.id).toBe(A_UUID);
    expect(body.games[0]!.players).toBe(1);
    await app.close();
  });
});

describe('GET /api/games/:matchId/summary', () => {
  it('404 for a non-uuid id', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/games/garbage/summary' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('404 for an unknown (well-formed) id', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/games/${A_UUID}/summary` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('404 for an IN-PROGRESS match — leak safety', async () => {
    const { app, store } = await buildApp();
    store.setMatchForTest({
      id: A_UUID,
      setupId: 'classic',
      config: {},
      seed: 's',
      startedAt: 1,
      endedAt: null,
      outcome: null,
      serverBuild: 'test',
      fingerprint: 'fp',
      mode: 'casual',
      players: [
        { userOrGuestId: 'g1', seat: 0, role: 'SHERIFF', faction: 'TOWN', outcome: 'win', survived: true, deathDay: null },
      ],
      events: [],
      chat: [],
    } as never);
    const res = await app.inject({ method: 'GET', url: `/api/games/${A_UUID}/summary` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('OG/share routes (SPA shell + injected meta)', () => {
  it('/join/:code serves HTML with the escaped og:title and a <title>', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/join/ABC123' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain('<div id="root">'); // the SPA shell is intact
    expect(html).toContain('<title>Join my table — Nocturne</title>');
    expect(html).toContain('property="og:title" content="Join my table — Nocturne"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('/og-card.png');
    await app.close();
  });

  it('escapes a hostile-looking value injected into the card (no raw HTML)', async () => {
    const { app } = await buildApp();
    // A code with HTML metacharacters must come back escaped in og:title.
    const res = await app.inject({ method: 'GET', url: '/join/%3Cscript%3E' });
    expect(res.statusCode).toBe(200);
    // The join card title is static text, but the URL is echoed into og:url —
    // assert no unescaped '<script>' lands in the document.
    expect(res.body).not.toContain('<script>');
    await app.close();
  });

  it('/u/:username returns index.html with a generic card (200, not 500) for an unknown user', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/u/nobody' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
    expect(res.body).toContain('<title>nobody — Nocturne</title>');
    await app.close();
  });

  it('/replay/:matchId serves a generic card for an unknown match (never errors)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/replay/${A_UUID}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('property="og:title"');
    expect(res.body).toContain('<div id="root">');
    await app.close();
  });
});
