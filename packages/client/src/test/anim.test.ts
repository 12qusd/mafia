/**
 * Tests for the cinematic-layer pure helpers (goal: animation layer). The R3F
 * canvas itself is not unit-tested (no WebGL in jsdom); these cover the
 * deterministic decision logic that drives it: effective level/gating,
 * phase→mood/transition, and the tier→death-cinematic selection.
 */

import { describe, it, expect } from 'vitest';
import {
  effectiveAnimationLevel,
  shouldMountCanvas,
  moodForPhase,
  transitionForChange,
  deathVariantForTier,
  deathSpecForTier,
  effectForCause,
  TRANSITION_LABEL,
} from '../lib/anim.js';
import { POINTS_TIERS, DEATH_CAUSES } from '@nocturne/shared';
import { loadSettings, DEFAULT_SETTINGS, type ClientSettings } from '../lib/storage.js';

describe('effectiveAnimationLevel (reduced-motion only downgrades)', () => {
  it('passes through when reduced-motion is off', () => {
    expect(effectiveAnimationLevel('full', false)).toBe('full');
    expect(effectiveAnimationLevel('reduced', false)).toBe('reduced');
    expect(effectiveAnimationLevel('off', false)).toBe('off');
  });
  it('downgrades full → reduced under reduced-motion, never upgrades', () => {
    expect(effectiveAnimationLevel('full', true)).toBe('reduced');
    expect(effectiveAnimationLevel('reduced', true)).toBe('reduced');
    expect(effectiveAnimationLevel('off', true)).toBe('off');
  });
});

describe('shouldMountCanvas (the single WebGL gate)', () => {
  it('mounts the heavy canvas only at the full level', () => {
    expect(shouldMountCanvas('full')).toBe(true);
    expect(shouldMountCanvas('reduced')).toBe(false);
    expect(shouldMountCanvas('off')).toBe(false);
  });
  it('reduced-motion users never mount the canvas even when set to full', () => {
    expect(shouldMountCanvas(effectiveAnimationLevel('full', true))).toBe(false);
  });
});

describe('moodForPhase', () => {
  it('maps phases to distinct moods', () => {
    expect(moodForPhase('NIGHT')).toBe('night');
    expect(moodForPhase('DAWN')).toBe('dawn');
    expect(moodForPhase('DAY_DISCUSSION')).toBe('day');
    expect(moodForPhase('DAY_VOTING')).toBe('day');
    expect(moodForPhase('DAY_0')).toBe('day');
    expect(moodForPhase('TRIAL_DEFENSE')).toBe('gallows');
    expect(moodForPhase('TRIAL_JUDGMENT')).toBe('gallows');
    expect(moodForPhase('EXECUTION')).toBe('gallows');
  });
  it('falls back to day for null/unknown', () => {
    expect(moodForPhase(null)).toBe('day');
  });
});

describe('transitionForChange', () => {
  it('emits a named flourish for each mood change', () => {
    expect(transitionForChange('day', 'night')).toBe('nightfall');
    expect(transitionForChange('night', 'dawn')).toBe('daybreak');
    expect(transitionForChange('dawn', 'day')).toBe('gather');
    expect(transitionForChange('day', 'gallows')).toBe('gallows');
  });
  it('returns null when the mood is unchanged', () => {
    expect(transitionForChange('night', 'night')).toBeNull();
    expect(transitionForChange(null, 'day')).toBe('gather');
  });
  it('has copy for every transition', () => {
    for (const key of ['nightfall', 'daybreak', 'gather', 'gallows'] as const) {
      expect(TRANSITION_LABEL[key]).toBeTruthy();
    }
  });
});

describe('deathVariantForTier (the explicit tier → cinematic ask)', () => {
  it('maps each real tier key to its own variant', () => {
    for (const t of POINTS_TIERS) {
      expect(deathVariantForTier(t.key)).toBe(t.key);
    }
  });
  it('falls back to the restrained drifter variant for unknown/missing tiers', () => {
    expect(deathVariantForTier(null)).toBe('drifter');
    expect(deathVariantForTier(undefined)).toBe('drifter');
    expect(deathVariantForTier('overlord')).toBe('drifter');
    expect(deathVariantForTier('')).toBe('drifter');
  });
});

describe('deathSpecForTier (increasingly spectacular)', () => {
  const order = ['drifter', 'made', 'capo', 'boss', 'kingpin'] as const;

  it('scales particle count strictly upward with tier', () => {
    const counts = order.map((t) => deathSpecForTier(t).particles);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
  });
  it('scales duration upward (longer, grander send-offs)', () => {
    const durs = order.map((t) => deathSpecForTier(t).durationMs);
    for (let i = 1; i < durs.length; i++) {
      expect(durs[i]!).toBeGreaterThanOrEqual(durs[i - 1]!);
    }
  });
  it('only the top tiers earn a memorial card and screen-wide flourish', () => {
    expect(deathSpecForTier('drifter').memorialCard).toBe(false);
    expect(deathSpecForTier('made').memorialCard).toBe(false);
    expect(deathSpecForTier('capo').memorialCard).toBe(true);
    expect(deathSpecForTier('drifter').screenWide).toBe(false);
    expect(deathSpecForTier('boss').screenWide).toBe(true);
    expect(deathSpecForTier('kingpin').screenWide).toBe(true);
  });
  it('kingpin is the most lavish (gold accent, longest, most particles)', () => {
    const k = deathSpecForTier('kingpin');
    expect(k.accent).toBe('gold');
    expect(k.slowmo).toBeGreaterThan(deathSpecForTier('drifter').slowmo);
  });
});

describe('effectForCause (other seats: cause-appropriate flourish)', () => {
  it('has an effect for every death cause', () => {
    for (const cause of DEATH_CAUSES) {
      expect(effectForCause(cause)).toBeTruthy();
    }
  });
  it('maps causes to sensible effects', () => {
    expect(effectForCause('mafia')).toBe('knife');
    expect(effectForCause('serial_killer')).toBe('knife');
    expect(effectForCause('vigilante')).toBe('shot');
    expect(effectForCause('lynch')).toBe('noose');
    expect(effectForCause('jailor_execute')).toBe('noose');
    expect(effectForCause('jester_grief')).toBe('poison');
    expect(effectForCause('leave')).toBe('shroud');
    expect(effectForCause('admin')).toBe('shroud');
  });
});

describe('settings persistence: animations slice', () => {
  it('defaults to full', () => {
    expect(DEFAULT_SETTINGS.animations).toBe('full');
  });
  it('round-trips a stored animation level and rejects garbage', () => {
    const store: Record<string, string> = {};
    const orig = globalThis.localStorage;
    // Minimal localStorage stub for the storage helpers.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
    try {
      const good: Partial<ClientSettings> = { animations: 'reduced' };
      store['nocturne.settings'] = JSON.stringify(good);
      expect(loadSettings().animations).toBe('reduced');

      store['nocturne.settings'] = JSON.stringify({ animations: 'nonsense' });
      expect(loadSettings().animations).toBe('full');

      store['nocturne.settings'] = JSON.stringify({ animations: 'off' });
      expect(loadSettings().animations).toBe('off');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: orig });
    }
  });
});
