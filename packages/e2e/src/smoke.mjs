/**
 * Browser E2E smoke for Project NOCTURNE — the guest core loop.
 *
 * Standalone runner. NOT part of `pnpm -r test` / the unit gate (a real browser
 * driving a full bot-backed game is slow + needs a chromium binary, so it must
 * never slow or flake the unit gate). Run it manually / as an optional CI step:
 *
 *     pnpm e2e            # from the repo root
 *
 * What it does:
 *   1. builds the client + server (so the server serves the freshly-built SPA),
 *   2. boots the REAL server in NO_DB mode on an ephemeral loopback port,
 *   3. launches the already-installed chromium via playwright-core,
 *   4. drives the GUEST core loop: home → Quick Play → wait for the bot-backfilled
 *      game to start → assert it is LIVE (a role card + seats render),
 *   5. asserts zero console errors across the journey.
 *
 * Account flows (register / forum / DMs) need a database; this smoke deliberately
 * stays on the guest gameplay loop, which is the highest-value browser coverage
 * and the only thing that runs under NO_DB.
 *
 * Robustness: if no chromium binary is found it prints `SKIP: …` and exits 0 so a
 * CI without a browser never hard-fails. All waits use generous timeouts.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

const STEP_TIMEOUT = 60_000; // generous per-step ceiling for slow CI boxes.
const GAME_START_TIMEOUT = 60_000; // bot backfill + deal can take a while headless.

function log(msg) {
  process.stdout.write(`[e2e] ${msg}\n`);
}

/** Locate the chromium executable, or null if none is available. */
function findChromium() {
  const fromFile = (() => {
    try {
      const p = readFileSync('/tmp/shot/chrome_path.txt', 'utf8').trim();
      return p && existsSync(p) ? p : null;
    } catch {
      return null;
    }
  })();
  const fromEnv =
    process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)
      ? process.env.PLAYWRIGHT_CHROMIUM
      : null;
  return fromFile ?? fromEnv ?? null;
}

/** Build client + server so the server serves a current SPA bundle. */
function buildClientAndServer() {
  log('building client + server…');
  const res = spawnSync(
    'pnpm',
    ['--filter', '@nocturne/client', '--filter', '@nocturne/server', 'build'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) {
    throw new Error(`build failed (exit ${res.status})`);
  }
}

/** Boot the real server in NO_DB on an ephemeral port; resolve its base URL. */
async function startServer() {
  process.env.NO_DB = '1';
  delete process.env.DATABASE_URL;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  // Indirect specifier so this isn't bundled/resolved at lint time.
  const spec = '@nocturne/server';
  const { buildApp, loadConfig } = await import(spec);
  const cfg = {
    ...loadConfig({ ...process.env, NO_DB: '1', HOST: '127.0.0.1', PORT: '0' }),
    host: '127.0.0.1',
  };
  const built = await buildApp(cfg);
  await built.listen();
  const addr = built.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    shutdown: () => built.shutdown(false),
  };
}

async function run() {
  const chromiumPath = findChromium();
  if (!chromiumPath) {
    log(
      'SKIP: no chromium binary (set PLAYWRIGHT_CHROMIUM or /tmp/shot/chrome_path.txt). ' +
        'Browser smoke skipped; exiting 0.',
    );
    process.exit(0);
  }
  log(`using chromium at ${chromiumPath}`);

  buildClientAndServer();

  const { chromium } = await import('playwright-core');

  let server;
  let browser;
  const consoleErrors = [];
  try {
    server = await startServer();
    log(`server up at ${server.baseUrl}`);

    browser = await chromium.launch({
      executablePath: chromiumPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    });
    const page = await browser.newPage();

    // Collect GENUINE app errors across the journey: uncaught exceptions
    // (pageerror) and explicit console.error calls from app code.
    //
    // We deliberately ignore the browser's automatic "Failed to load resource:
    // … 401/403 …" console messages: the app fetches `GET /api/me` on mount,
    // which intentionally 401s for a guest with no HTTP session and is handled
    // (treated as "signed out" — see lib/api.ts fetchMe). The browser logs that
    // failed fetch to the console regardless; it is expected, not an app fault.
    const isBenignNetwork = (text) =>
      /Failed to load resource: the server responded with a status of (401|403)\b/.test(text);
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (isBenignNetwork(text)) return;
      consoleErrors.push(`console.error: ${text}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // 1) Load home.
    log('loading home…');
    await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    // The Quick Play button is enabled once the WS `welcome` arrives (guest).
    const quickPlay = page.locator('button.btn-quickplay', { hasText: 'Quick Play' }).first();
    await quickPlay.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    await page
      .locator('button.btn-quickplay:not([disabled])')
      .first()
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
    log('home ready (guest connected)');

    // 2) Quick Play → bot-backfilled game.
    log('clicking Quick Play…');
    await quickPlay.click();

    // 3) Wait for the game to go LIVE: the own-seat role card renders.
    log('waiting for the game to start (role card + seats)…');
    const roleCard = page.locator('.role-card .role-name').first();
    await roleCard.waitFor({ state: 'visible', timeout: GAME_START_TIMEOUT });
    const roleName = (await roleCard.textContent())?.trim() ?? '';
    if (!roleName) throw new Error('role card rendered but role name was empty');
    log(`game is live — own role: "${roleName}"`);

    // 4) Assert seats render (the seat roster is populated).
    const seatCount = await page.locator('.seat-list .seat-name').count();
    if (seatCount < 4) {
      throw new Error(`expected a populated seat roster, saw ${seatCount} seats`);
    }
    log(`seat roster rendered with ${seatCount} seats`);

    // 5) Zero console errors across the journey.
    if (consoleErrors.length > 0) {
      throw new Error(
        `journey produced ${consoleErrors.length} console error(s):\n  - ${consoleErrors.join(
          '\n  - ',
        )}`,
      );
    }

    log('PASS: guest core loop is live, role + seats render, zero console errors.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.shutdown().catch(() => {});
  }
}

run().catch((err) => {
  log(`FAIL: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
