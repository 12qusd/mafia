/**
 * Leak-detector test (BUILD_SPEC §5, §12.3 — CI-gating).
 *
 * Runs ≥20 randomized games through the engine FAST simulator and asserts the §5
 * entitlement table over EVERY captured frame at EVERY client. Bounded + seeded so
 * ordinary CI stays fast; the full §12.3 sweep (200 games) is `pnpm leakcheck`.
 */

import { describe, it, expect } from 'vitest';
import { playEngineGame } from '../sim-engine.js';

describe('leak detector — §5 entitlement table (§12.3)', () => {
  it('20 seeded 9-player games leak nothing', () => {
    let leakReports: string[] = [];
    let completed = 0;
    for (let g = 0; g < 20; g++) {
      const r = playEngineGame({ players: 9, seed: `leak-${g}`, setupId: 'classic-nocturne' });
      if (r.completed) completed++;
      if (r.leaks.length) {
        leakReports = leakReports.concat(
          r.leaks.map(
            (v) =>
              `game ${g} seat ${v.observerSeat}${v.observerIsSpectator ? '(spec)' : ''} ` +
              `${v.frameType}: ${v.reason} :: ${JSON.stringify(v.frame)}`,
          ),
        );
      }
    }
    expect(leakReports).toEqual([]);
    // Every game must terminate (no hangs / non-termination).
    expect(completed).toBe(20);
  });

  it('covers small (7) and large (14) player counts without leaks', () => {
    for (const players of [7, 14]) {
      for (let g = 0; g < 5; g++) {
        const r = playEngineGame({ players, seed: `size-${players}-${g}`, setupId: 'classic-nocturne' });
        expect(r.completed).toBe(true);
        expect(r.leaks).toEqual([]);
      }
    }
  });

  it('curated setups also leak nothing at 15 players', () => {
    for (const setupId of ['cross-examination', 'gunsmoke']) {
      const r = playEngineGame({ players: 15, seed: `curated-${setupId}`, setupId });
      expect(r.completed).toBe(true);
      expect(r.leaks).toEqual([]);
    }
  });
});
