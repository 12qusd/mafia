/**
 * OG / link-preview meta injection (retention front-end).
 *
 * Social/link-preview crawlers don't run the SPA, so they never see the cards a
 * shared replay/profile/invite deserves. These explicit GET HTML routes serve
 * the SAME index.html the SPA boots from, but with a block of Open Graph +
 * Twitter meta tags injected into <head> per request. A human's browser still
 * boots the SPA normally (React Router takes over client-side); a crawler reads
 * the injected card.
 *
 * HTTP-only and additive. This NEVER touches the engine, the game WS protocol,
 * or the §5 leak path. The replay card is built from the PUBLIC, FINISHED-only
 * match summary (getPublicMatchSummary returns null for in-progress games), so
 * no in-progress roles/seats can leak. Every user-derived value is HTML-escaped
 * before injection. Any lookup failure or NO_DB ⇒ a generic Nocturne card
 * (never a 500, never blocking the SPA).
 *
 * These routes are registered as explicit GETs so they take precedence over the
 * static-file wildcard + SPA not-found fallback for exactly these paths. They
 * must not shadow `/api/*` or hashed asset requests (they don't — the paths are
 * disjoint).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { GAME_NAME, tierForPoints } from '@nocturne/shared';
import type { GatewayContext } from '../ws/context.js';
import { escapeHtml } from './html.js';

/** A single static share image (1200x630). Lives in the client `public/` dir. */
const OG_IMAGE_PATH = '/og-card.png';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The card values injected into <head> (all already plain text; escaped here). */
interface OgCard {
  title: string;
  description: string;
  /** og:type (website | article | profile). */
  type: string;
  /** Absolute canonical URL for og:url. */
  url: string;
}

/**
 * Human-readable faction name from a raw outcome/faction token. Outcomes are
 * faction-ish strings (TOWN, MAFIA, …); we title-case for the card. Unknown or
 * empty falls back to a neutral phrasing handled by the caller.
 */
function factionLabel(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/_/g, ' ').trim().toLowerCase();
  if (cleaned.length === 0) return null;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render the meta block (already-escaped values) injected before </head>. We
 * also emit a fresh <title> so the browser tab + crawler title match.
 */
function metaBlock(card: OgCard, ogImageUrl: string): string {
  const t = escapeHtml(card.title);
  const d = escapeHtml(card.description);
  const u = escapeHtml(card.url);
  const img = escapeHtml(ogImageUrl);
  const type = escapeHtml(card.type);
  return [
    `<title>${t}</title>`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:site_name" content="${escapeHtml(GAME_NAME)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ].join('\n    ');
}

export function registerShareRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  const base = ctx.cfg.publicBaseUrl;
  const ogImageUrl = `${base}${OG_IMAGE_PATH}`;

  // Read index.html ONCE at startup and cache it. If the built client is absent
  // (API/WS-only deployment), these routes simply don't register — there is no
  // SPA shell to serve.
  let indexHtml: string | null = null;
  try {
    const distDir = resolve(process.cwd(), ctx.cfg.clientDistDir);
    indexHtml = readFileSync(resolve(distDir, 'index.html'), 'utf8');
  } catch {
    indexHtml = null;
  }
  if (indexHtml === null) return; // No client shell ⇒ nothing to inject into.
  // Strip the SPA's baseline <title> + og:/twitter: meta so the per-page block we
  // inject is the ONLY card on a share route. (index.html ships a generic card
  // for ordinary SPA routes; leaving it in place would put a generic og:title
  // BEFORE our injected one, and crawlers use the first occurrence — defeating
  // the per-replay/per-profile card.) Computed once; the shell is request-independent.
  const shell = indexHtml
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, '');

  /** A neutral fallback card for unknown lookups / NO_DB (never an error). */
  function genericCard(path: string): OgCard {
    return {
      title: `${GAME_NAME} — 1920s-noir social deduction`,
      description: 'Find your table. Read the room. Survive the night.',
      type: 'website',
      url: `${base}${path}`,
    };
  }

  /** Inject the meta block immediately before the first </head> and serve. */
  function serve(reply: FastifyReply, card: OgCard): FastifyReply {
    const block = metaBlock(card, ogImageUrl);
    const idx = shell.indexOf('</head>');
    const html =
      idx === -1
        ? // No </head> (shouldn't happen) — prepend so a crawler still sees it.
          `${block}\n${shell}`
        : `${shell.slice(0, idx)}    ${block}\n  ${shell.slice(idx)}`;
    return reply.type('text/html').send(html);
  }

  // --- /replay/:matchId — shareable, FINISHED-only match card --------------
  app.get<{ Params: { matchId: string } }>('/replay/:matchId', async (req, reply) => {
    const path = `/replay/${req.params.matchId}`;
    if (!UUID_RE.test(req.params.matchId)) return serve(reply, genericCard(path));
    let card = genericCard(path);
    try {
      // Public summary is FINISHED-only (null for unknown OR in-progress).
      const summary = await ctx.store.getPublicMatchSummary(req.params.matchId);
      if (summary) {
        const faction = factionLabel(summary.outcome);
        const n = summary.seats.length;
        const desc = faction
          ? `${faction} prevails — ${n} players, ${summary.setupId}`
          : `A finished table — ${n} players, ${summary.setupId}`;
        card = {
          title: `${GAME_NAME} — ${summary.setupId} replay`,
          description: desc,
          type: 'article',
          url: `${base}${path}`,
        };
      }
    } catch {
      // Lookup failure ⇒ generic card (never a 500).
    }
    return serve(reply, card);
  });

  // --- /u/:username — public profile card ----------------------------------
  app.get<{ Params: { username: string } }>('/u/:username', async (req, reply) => {
    const username = req.params.username;
    const path = `/u/${username}`;
    let card: OgCard = {
      title: `${username} — ${GAME_NAME}`,
      description: `A player at the tables of ${GAME_NAME}.`,
      type: 'profile',
      url: `${base}${path}`,
    };
    try {
      if (ctx.store.persistent) {
        const user = await ctx.store.getUserByUsername(username);
        if (user) {
          const stats = await ctx.store.getUserStats(user.id);
          const points = stats?.totalPoints ?? 0;
          const tier = tierForPoints(points).name;
          const games = stats?.gamesPlayed ?? 0;
          card = {
            title: `${user.username} — ${GAME_NAME}`,
            description: `${tier} · ${points} rep · ${games} games`,
            type: 'profile',
            url: `${base}${path}`,
          };
        }
      }
    } catch {
      // Unknown user / NO_DB / failure ⇒ the generic-ish profile card above.
    }
    return serve(reply, card);
  });

  // --- /join/:code — table invite card (no lookup) -------------------------
  app.get<{ Params: { code: string } }>('/join/:code', async (req, reply) => {
    const card: OgCard = {
      title: `Join my table — ${GAME_NAME}`,
      description: 'A game of 1920s-noir social deduction. Pull up a chair.',
      type: 'website',
      url: `${base}/join/${req.params.code}`,
    };
    return serve(reply, card);
  });
}
