/**
 * Real smoke test for TEST MODE (final gate):
 *   - boots the REAL server binary with NOCTURNE_TEST_MODE=1 NO_DB=1,
 *   - a host bot creates a test lobby, adds 6 bots via test_control add_bot
 *     (host + 6 = 7 players for classic-nocturne),
 *   - drives the game with end_phase through to game_over,
 *   - asserts debug_trace frames were received and the audit endpoint returns
 *     the full match JSON.
 *
 * Run: node scripts/smoke-test-mode.mjs
 */

import { spawn } from 'node:child_process';
import { BotClient } from '../packages/bots/dist/client.js';

const ADMIN_TOKEN = 'smoke-admin-token';
const PORT = 8137;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function until(pred, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await wait(30);
  }
  return pred();
}

async function main() {
  const server = spawn('node', ['packages/server/dist/index.js'], {
    env: {
      ...process.env,
      NOCTURNE_TEST_MODE: '1',
      NO_DB: '1',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ADMIN_TOKEN,
      CLIENT_DIST_DIR: '/nonexistent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(d));

  const httpUrl = `http://127.0.0.1:${PORT}`;
  const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

  // Wait for the server to accept connections.
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      const res = await fetch(`${httpUrl}/healthz`);
      if (res.ok) up = true;
    } catch {
      await wait(100);
    }
  }
  if (!up) throw new Error('server did not come up');

  const host = new BotClient({ url: wsUrl, name: 'Smoke Host' });
  await host.connect();
  host.send({
    v: 1,
    type: 'create_lobby',
    name: 'Smoke',
    visibility: 'private',
    setupId: 'classic-nocturne',
    config: { testMode: true },
  });
  await until(() => host.lobbyId !== null);
  const roomId = host.lobbyId;
  console.log(`[smoke] test lobby created: ${roomId}`);

  host.send({ v: 1, type: 'test_control', action: 'add_bot', count: 6, policy: 'scripted' });
  const filled = await until(() => host.lobbyMembers.length >= 7);
  if (!filled) throw new Error(`lobby did not fill: ${host.lobbyMembers.length} members`);
  console.log(`[smoke] backfilled to ${host.lobbyMembers.length} players (host + 6 bots)`);

  host.send({ v: 1, type: 'start_game' });
  await until(() => host.capture.some((m) => m.type === 'debug_state'));
  console.log('[smoke] game started; host receiving god-view debug_state');

  // Drive end_phase repeatedly to completion without waiting timers.
  const done = await until(() => {
    if (!host.view.over) host.send({ v: 1, type: 'test_control', action: 'end_phase' });
    return host.view.over;
  }, 30000);
  if (!done) throw new Error('game did not reach game_over');

  const traceCount = host.capture.filter((m) => m.type === 'debug_trace').length;
  const eventCount = host.capture.filter((m) => m.type === 'debug_event').length;
  const stateCount = host.capture.filter((m) => m.type === 'debug_state').length;
  console.log(
    `[smoke] game over. debug_state=${stateCount} debug_trace=${traceCount} debug_event=${eventCount}`,
  );
  if (traceCount < 1) throw new Error('expected at least one debug_trace frame');

  // Audit endpoint returns the full match JSON (admin-authorized).
  const auditRes = await fetch(`${httpUrl}/api/test/match/${roomId}/audit`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  if (auditRes.status !== 200) throw new Error(`audit endpoint status ${auditRes.status}`);
  const audit = await auditRes.json();
  console.log(
    `[smoke] audit OK: setup=${audit.setupId} seed=${String(audit.seed).slice(0, 12)}… ` +
      `seats=${audit.seats.length} actionLog=${audit.actionLog.length} traces=${audit.traces.length}`,
  );
  if (audit.setupId !== 'classic-nocturne') throw new Error('audit setupId mismatch');
  if (audit.seats.length !== 7) throw new Error('audit seat count mismatch');
  if (!Array.isArray(audit.actionLog) || audit.actionLog.length === 0)
    throw new Error('audit action log empty');

  // A non-test / unknown room is a 404.
  const missing = await fetch(`${httpUrl}/api/test/match/nope/audit`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  if (missing.status !== 404) throw new Error(`expected 404 for unknown room, got ${missing.status}`);

  host.close();
  server.kill('SIGTERM');
  console.log('[smoke] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
