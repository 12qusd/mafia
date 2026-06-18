/**
 * `pnpm leakcheck` — full §12.3 leak sweep (BUILD_SPEC §5, §12.3).
 *
 * Usage: pnpm leakcheck -- [--games 200] [--players 9] [--setup classic_nocturne]
 *
 * Runs the requested number of randomized games through the engine FAST path (so
 * 200+ games complete in well under a second), auditing EVERY captured frame at
 * EVERY client against the §5 entitlement table. Exits non-zero on any leak — this
 * is the CI-gating sweep. The vitest `leak.test.ts` runs a smaller bounded set to
 * keep ordinary CI fast; this CLI is the full sweep.
 */

import { playEngineGame } from '../sim-engine.js';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}

const SETUP_MAP: Record<string, string> = {
  classic_nocturne: 'classic-nocturne',
  'classic-nocturne': 'classic-nocturne',
  cross_examination: 'cross-examination',
  'cross-examination': 'cross-examination',
  gunsmoke: 'gunsmoke',
  smoke_and_mirrors: 'smoke-and-mirrors',
  'smoke-and-mirrors': 'smoke-and-mirrors',
};

function main(): void {
  const games = Number(arg('games', '200'));
  const players = Number(arg('players', '9'));
  const setupId = SETUP_MAP[arg('setup', 'classic_nocturne')] ?? 'classic-nocturne';
  const seedBase = Number(arg('seedBase', '1'));

  console.log(`[leakcheck] sweeping ${games} games (players=${players}, setup=${setupId})`);
  const t0 = Date.now();
  let leaks = 0;
  let completed = 0;
  let firstLeak: string | null = null;

  for (let g = 0; g < games; g++) {
    let r;
    try {
      r = playEngineGame({ players, seed: `${seedBase + g}`, setupId });
    } catch (err) {
      console.error(`[leakcheck] cannot run setup "${setupId}" with ${players} players: ${String(err)}`);
      console.error(`[leakcheck] (curated setups cross-examination/gunsmoke are 15-player only)`);
      process.exit(2);
    }
    if (r.completed) completed++;
    if (r.leaks.length) {
      leaks += r.leaks.length;
      for (const v of r.leaks) {
        console.error(
          `[leakcheck] LEAK game ${g} seat ${v.observerSeat}${v.observerIsSpectator ? '(spec)' : ''} ` +
            `frame#${v.frameIndex} type=${v.frameType}: ${v.reason}`,
        );
        console.error(`            frame: ${JSON.stringify(v.frame)}`);
      }
      if (!firstLeak) firstLeak = r.leaks[0]!.reason;
    }
  }
  const dt = Date.now() - t0;
  console.log(`[leakcheck] ${games} games in ${dt}ms; completed ${completed}/${games}; leaks=${leaks}`);
  if (leaks > 0) {
    console.error(`[leakcheck] FAILED — first leak: ${firstLeak}`);
    process.exit(1);
  }
  console.log(`[leakcheck] PASSED — no entitlement violations across ${games} games`);
  process.exit(0);
}

main();
