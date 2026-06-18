import { describe, it, expect } from 'vitest';
import { dailySetupId, dailyChaosSeed, dailyFeature } from './daily.js';
import { SETUPS } from './index.js';

const SHIPPED_IDS = new Set(SETUPS.map((s) => s.id));

describe('dailySetupId — rotation', () => {
  it('always resolves to a shipped setup id', () => {
    for (const day of ['2026-01-01', '2026-06-18', '2026-12-31', '2025-03-15']) {
      expect(SHIPPED_IDS.has(dailySetupId(day))).toBe(true);
    }
  });

  it('is deterministic for a given date', () => {
    expect(dailySetupId('2026-06-18')).toBe(dailySetupId('2026-06-18'));
  });

  it('ignores any time component (slices to YYYY-MM-DD)', () => {
    expect(dailySetupId('2026-06-18T13:45:00.000Z')).toBe(dailySetupId('2026-06-18'));
  });

  it('rotates across dates (not always the same id)', () => {
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      ids.add(dailySetupId(`2026-02-${String(d).padStart(2, '0')}`));
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('dailyChaosSeed / dailyFeature', () => {
  it('chaos seed is date-derived and stable', () => {
    expect(dailyChaosSeed('2026-06-18')).toBe('daily-2026-06-18');
    expect(dailyChaosSeed('2026-06-18T09:00:00Z')).toBe('daily-2026-06-18');
  });

  it('dailyFeature bundles the rotated setup id and chaos seed', () => {
    const f = dailyFeature('2026-06-18');
    expect(f.setupId).toBe(dailySetupId('2026-06-18'));
    expect(f.chaosSeed).toBe(dailyChaosSeed('2026-06-18'));
    expect(SHIPPED_IDS.has(f.setupId)).toBe(true);
  });
});
