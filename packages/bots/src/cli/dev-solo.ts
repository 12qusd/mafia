/**
 * `pnpm dev:solo` — one human + N bots, local (BUILD_SPEC §12.2, M1 acceptance).
 *
 * Boots the REAL server (NO_DB=1, PORT 8080) in-process, spawns 8–14 policy bots
 * that connect over loopback, has a host bot create a PRIVATE lobby, and prints
 * the invite code + join URL PROMINENTLY so a human can open the browser client
 * and join. The bots wait for the human; once the human is in (or after a short
 * grace if you start solo-testing), the host bot starts the game and plays a full
 * round alongside you. Ctrl-C to stop.
 *
 * Ergonomics decision (DECISIONS.md): bots create the lobby and we read the
 * server-side invite code directly from the in-process LobbyManager (the public
 * lobby DTO omits it by §5), so the human gets a working /join/<CODE> link.
 *
 * Usage: pnpm dev:solo [-- --bots 10 --setup classic_nocturne --autostart]
 */

import { loadServerModule } from '../server-facade.js';
import { BotClient } from '../client.js';
import { BotPolicy } from '../policy.js';
import { FAST_TIMINGS } from '../timings.js';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const SETUP_MAP: Record<string, string> = {
  classic_nocturne: 'classic-nocturne',
  'classic-nocturne': 'classic-nocturne',
  cross_examination: 'cross-examination',
  'cross-examination': 'cross-examination',
  gunsmoke: 'gunsmoke',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const setupId = SETUP_MAP[arg('setup', 'classic_nocturne')] ?? 'classic-nocturne';
  const botCount = Math.min(14, Math.max(8, Number(arg('bots', '10'))));
  const autostart = flag('autostart');
  const port = Number(arg('port', '8080'));

  // loadConfig reads NO_DB/PORT from process.env directly, so set them here.
  process.env.NO_DB = '1';
  if (process.env.DATABASE_URL) delete process.env.DATABASE_URL;
  process.env.PORT = String(port);
  const { buildApp, loadConfig } = await loadServerModule();
  const cfg = { ...loadConfig({ ...process.env, NO_DB: '1', HOST: '0.0.0.0', PORT: String(port) } as NodeJS.ProcessEnv) };
  const built = await buildApp(cfg);
  await built.listen();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const httpBase = `http://localhost:${port}`;

  console.log(`\n=== NOCTURNE dev:solo ===`);
  console.log(`server: ${httpBase}  (ws: ${wsUrl})  NO_DB=1`);

  // Spawn the host bot + fillers. Host connects first so it owns the lobby.
  const bots: BotClient[] = [];
  for (let i = 0; i < botCount; i++) {
    const bot = new BotClient({ url: wsUrl, name: `bot-${i}` });
    bots.push(bot);
  }
  await bots[0]!.connect();
  for (let i = 1; i < bots.length; i++) await bots[i]!.connect();

  // Wire policies and inject seats (join order; host=0, then bots, the HUMAN
  // will be the last seat to join — bots leave room for one human within the
  // setup's max). Seats are re-derived at start, but the policy only needs a
  // self id; we set it to the connect index, and the human takes the next seat.
  const policies: BotPolicy[] = bots.map((bot, i) => {
    const policy = new BotPolicy(bot, { seed: `dev-solo:bot:${i}` });
    bot.setSeat(i);
    bot.policyDrive = (m) => policy.onFrame(m);
    return policy;
  });

  const host = bots[0]!;
  host.send({
    v: 1,
    type: 'create_lobby',
    name: 'dev:solo',
    visibility: 'private',
    setupId,
    config: { timings: FAST_TIMINGS, whispersEnabled: true, deadSeeAll: true, lastWillsEnabled: true },
  });
  await waitFor(() => host.lobbyId !== null, 5_000);
  const lobbyId = host.lobbyId!;

  // Fillers join.
  for (let i = 1; i < bots.length; i++) bots[i]!.send({ v: 1, type: 'join_lobby', lobbyId });

  // Read the invite code from the in-process LobbyManager (public DTO omits it).
  const lobby = built.ctx.manager.getLobby(lobbyId);
  const inviteCode = lobby?.inviteCode ?? null;

  console.log(`\n--------------------------------------------------------`);
  console.log(`  HUMAN: open the client and join this private lobby:`);
  if (inviteCode) {
    console.log(`    Invite code : ${inviteCode}`);
    console.log(`    Join URL    : ${httpBase}/join/${inviteCode}`);
  } else {
    console.log(`    Lobby id    : ${lobbyId}`);
  }
  console.log(`  (${botCount} bots are seated; you take the next open seat.)`);
  console.log(`  The host bot starts the game once you have joined.`);
  console.log(`--------------------------------------------------------\n`);

  // Wait for the human to join (a non-bot member appears), then start. If
  // --autostart, start immediately with bots only (no human).
  const botIds = new Set(bots.map((b) => b.identityId));
  const humanJoined = () =>
    host.lobbyMembers.some((m) => !m.isSpectator && !botIds.has(m.id));

  if (autostart) {
    console.log('[dev:solo] --autostart: starting with bots only in 2s...');
    await sleep(2000);
  } else {
    console.log('[dev:solo] waiting for a human to join (Ctrl-C to quit)...');
    const deadline = Date.now() + 10 * 60 * 1000; // 10 min
    while (!humanJoined() && Date.now() < deadline) await sleep(500);
    if (humanJoined()) {
      console.log('[dev:solo] human joined — starting in 3s.');
      await sleep(3000);
    } else {
      console.log('[dev:solo] no human within 10 min; starting with bots only.');
    }
  }

  host.send({ v: 1, type: 'start_game' });
  console.log('[dev:solo] game started. Play in the browser; bots will act each phase.');

  // Keep the process alive; tick policies so bots keep acting through the game
  // (re-affirm votes / change night kills before deadlines).
  const ticker = setInterval(() => {
    for (const p of policies) p.tick();
  }, 2000);
  if (ticker.unref) ticker.unref();

  process.on('SIGINT', () => {
    console.log('\n[dev:solo] shutting down...');
    clearInterval(ticker);
    for (const b of bots) b.close();
    void built.shutdown(false).then(() => process.exit(0));
  });
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred() && Date.now() < deadline) await sleep(20);
  if (!pred()) throw new Error('waitFor timed out');
}

main().catch((err) => {
  console.error('[dev:solo] fatal:', err);
  process.exit(1);
});
