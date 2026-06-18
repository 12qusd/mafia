/**
 * `pnpm sim` — headless game simulator CLI (BUILD_SPEC §12.2).
 *
 * Usage:
 *   pnpm sim -- --games N --players P --seedBase S [--setup classic_nocturne]
 *             [--mode socket|engine|both] [--spectator] [--timeoutMs N]
 *
 * Boots the REAL server in-process (NO_DB, ephemeral port), spawns P bots over
 * real loopback sockets, and plays N full games to game_over. Reports completion
 * count, durations, win-condition breakdown, leak count, and any errors.
 *
 * Two modes:
 *   - socket  : real WebSocket games through the gateway (default for small N).
 *   - engine  : FAST in-engine games for bulk determinism/leak sweeps.
 *   - both    : a few socket games + a bulk engine sweep.
 *
 * See DECISIONS.md for why the socket path is wall-clock-bound and the
 * engine FAST path exists.
 */

import { runSocketSim } from '../sim-socket.js';
import { playEngineGame } from '../sim-engine.js';
import { startInProcessServer } from '../server-harness.js';

interface Args {
  games: number;
  players: number;
  seedBase: number;
  setup: string;
  mode: 'socket' | 'engine' | 'both';
  spectator: boolean;
  timeoutMs: number | undefined;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const setupRaw = get('setup') ?? 'classic_nocturne';
  return {
    games: Number(get('games') ?? 10),
    players: Number(get('players') ?? 9),
    seedBase: Number(get('seedBase') ?? 1),
    setup: normalizeSetup(setupRaw),
    mode: (get('mode') as Args['mode']) ?? 'socket',
    spectator: has('spectator'),
    timeoutMs: get('timeoutMs') ? Number(get('timeoutMs')) : undefined,
  };
}

/** Accept both `classic_nocturne` (spec spelling) and the data id `classic-nocturne`. */
function normalizeSetup(id: string): string {
  const map: Record<string, string> = {
    classic_nocturne: 'classic-nocturne',
    'classic-nocturne': 'classic-nocturne',
    cross_examination: 'cross-examination',
    'cross-examination': 'cross-examination',
    gunsmoke: 'gunsmoke',
    tong_war: 'tong-war',
    'tong-war': 'tong-war',
  };
  return map[id] ?? id;
}

function pct(n: number, d: number): string {
  return d === 0 ? '0%' : `${((100 * n) / d).toFixed(1)}%`;
}

function stats(durations: number[]): { min: number; max: number; mean: number; p50: number } {
  if (durations.length === 0) return { min: 0, max: 0, mean: 0, p50: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: Math.round(sum / sorted.length),
    p50: sorted[Math.floor(sorted.length / 2)]!,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] mode=${args.mode} games=${args.games} players=${args.players} seedBase=${args.seedBase} setup=${args.setup}`,
  );

  const server = await startInProcessServer();
  console.log(`[sim] in-process server listening at ${server.wsUrl}`);
  let exitCode = 0;

  try {
    if (args.mode === 'engine' || args.mode === 'both') {
      const t0 = Date.now();
      let completed = 0;
      let leaks = 0;
      const wins: Record<string, number> = {};
      const fps = new Set<string>();
      const n = args.mode === 'both' ? Math.max(args.games, 100) : args.games;
      for (let g = 0; g < n; g++) {
        let r;
        try {
          r = playEngineGame({
            players: args.players,
            seed: `${args.seedBase + g}`,
            setupId: args.setup,
          });
        } catch (err) {
          console.error(`[sim][engine] cannot run setup "${args.setup}" with ${args.players} players: ${String(err)}`);
          console.error(`[sim][engine] (curated setups are 15-player only; classic-nocturne is 7–15)`);
          await server.shutdown();
          process.exit(2);
        }
        if (r.completed) {
          completed++;
          const key = r.winners.length ? [...r.winners].sort().join('+') : 'none';
          wins[key] = (wins[key] ?? 0) + 1;
        }
        leaks += r.leaks.length;
        fps.add(r.fingerprint);
        if (r.leaks.length) {
          exitCode = 1;
          console.error(
            `[sim][engine] LEAK game ${g}: ${r.leaks[0]!.reason} (frame ${r.leaks[0]!.frameType})`,
          );
        }
      }
      const dt = Date.now() - t0;
      console.log(`\n[sim][engine] ${n} games in ${dt}ms (${(dt / n).toFixed(2)} ms/game)`);
      console.log(`[sim][engine] completed: ${completed}/${n} (${pct(completed, n)})`);
      console.log(`[sim][engine] leaks: ${leaks}`);
      console.log(`[sim][engine] win breakdown:`, wins);
      console.log(`[sim][engine] distinct fingerprints: ${fps.size}`);
    }

    if (args.mode === 'socket' || args.mode === 'both') {
      const socketGames = args.mode === 'both' ? Math.min(args.games, 5) : args.games;
      const { summary } = await runSocketSim({
        games: socketGames,
        players: args.players,
        seedBase: args.seedBase,
        setupId: args.setup,
        withSpectator: args.spectator,
        ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
        server,
      });
      const s = stats(summary.durations);
      console.log(`\n[sim][socket] ${summary.games} real-WebSocket games`);
      console.log(
        `[sim][socket] completed: ${summary.completed}/${summary.games} (${pct(summary.completed, summary.games)})`,
      );
      console.log(
        `[sim][socket] durations ms: min=${s.min} p50=${s.p50} mean=${s.mean} max=${s.max}`,
      );
      console.log(`[sim][socket] leaks: ${summary.totalLeaks}`);
      console.log(`[sim][socket] error frames (rejected commands): ${summary.totalErrorFrames}`);
      console.log(`[sim][socket] win breakdown:`, summary.winBreakdown);
      if (summary.errors.length) {
        console.error(`[sim][socket] issues:`);
        for (const e of summary.errors) console.error(`  - ${e}`);
      }
      if (summary.totalLeaks > 0 || summary.completed < summary.games) exitCode = 1;
    }
  } finally {
    await server.shutdown();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[sim] fatal:', err);
  process.exit(1);
});
