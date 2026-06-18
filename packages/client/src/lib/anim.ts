/**
 * Pure helpers for the cinematic animation layer (goal: "make it feel alive").
 *
 * Everything here is framework-free and deterministic so it can be unit-tested
 * without a WebGL context. The actual three.js rendering lives in the lazily
 * loaded `components/stage/*` modules; this file just decides *what* to show.
 *
 * The guiding rules:
 *  - `prefers-reduced-motion` can only ever *downgrade* the chosen level, never
 *    upgrade it. So a user who picks 'full' but has the OS reduce-motion flag
 *    set still gets the lighter experience.
 *  - The heavy three.js canvas is mounted ONLY when the effective level is
 *    'full'. 'reduced' and 'off' fall back to the existing CSS scene tint.
 */

import type { Phase, DeathCause } from '@nocturne/shared';
import { POINTS_TIERS } from '@nocturne/shared';
import type { AnimationLevel } from './storage.js';

/** Whether the OS / browser asks us to minimise motion. */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Resolve the *effective* animation level given the user's setting and the
 * reduced-motion preference. Reduce-motion downgrades: 'full' → 'reduced',
 * and 'reduced'/'off' are left as-is (they are already light/none).
 */
export function effectiveAnimationLevel(
  setting: AnimationLevel,
  reducedMotion: boolean,
): AnimationLevel {
  if (reducedMotion && setting === 'full') return 'reduced';
  return setting;
}

/**
 * Should the heavy three.js <Canvas> backdrop be mounted at all? Only when the
 * effective level is 'full'. This is the single gate that keeps jsdom tests and
 * reduced-motion users from ever instantiating WebGL (and from downloading the
 * three.js chunk, since the stage is also behind React.lazy).
 */
export function shouldMountCanvas(level: AnimationLevel): boolean {
  return level === 'full';
}

/**
 * The mood a phase should evoke in the 3D backdrop. Distinct from the coarse
 * CSS `Scene` (day/dusk/night) so trials/executions get their own ominous look
 * separate from generic night.
 */
export type SceneMood = 'night' | 'dawn' | 'day' | 'gallows';

export function moodForPhase(phase: Phase | null): SceneMood {
  switch (phase) {
    case 'NIGHT':
    case 'ASSIGN':
      return 'night';
    case 'DAWN':
      return 'dawn';
    case 'DAY_0':
    case 'DAY_DISCUSSION':
    case 'DAY_VOTING':
      return 'day';
    case 'TRIAL_DEFENSE':
    case 'TRIAL_JUDGMENT':
    case 'EXECUTION':
      return 'gallows';
    default:
      return 'day';
  }
}

/** A short, named transition flourish played when the mood changes. */
export type PhaseTransition = 'nightfall' | 'daybreak' | 'gather' | 'gallows' | null;

/**
 * Pick the transition flourish for a mood change. Returns null when the mood is
 * unchanged or the move doesn't warrant a flourish.
 */
export function transitionForChange(from: SceneMood | null, to: SceneMood): PhaseTransition {
  if (from === to) return null;
  switch (to) {
    case 'night':
      return 'nightfall';
    case 'dawn':
      return 'daybreak';
    case 'day':
      return 'gather';
    case 'gallows':
      return 'gallows';
    default:
      return null;
  }
}

/** Human-facing flourish copy (rendered as drei <Text>, with CSS fallback). */
export const TRANSITION_LABEL: Record<NonNullable<PhaseTransition>, string> = {
  nightfall: 'Night falls',
  daybreak: 'Dawn breaks',
  gather: 'The town gathers',
  gallows: 'To the gallows',
};

// --- Death cinematics -------------------------------------------------------

/**
 * The five tier-scaled "own death" cinematics, ordered from restrained to
 * lavish. Keyed to the player's points tier (drifter→kingpin). Each is a
 * deliberately distinct, increasingly spectacular send-off.
 */
export type DeathVariant = 'drifter' | 'made' | 'capo' | 'boss' | 'kingpin';

/** Valid tier keys, in ascending order (mirrors POINTS_TIERS). */
const TIER_KEYS = POINTS_TIERS.map((t) => t.key);

/**
 * Map a tier key (from `me.stats.tier`) to a death-cinematic variant. Unknown /
 * missing tiers fall back to the most restrained variant ('drifter') so a stats
 * gap never throws or over-promises a lavish animation.
 */
export function deathVariantForTier(tier: string | null | undefined): DeathVariant {
  if (tier && (TIER_KEYS as readonly string[]).includes(tier)) {
    return tier as DeathVariant;
  }
  return 'drifter';
}

/** Per-variant tuning the 3D layer reads to scale its send-off. Larger = grander. */
export interface DeathVariantSpec {
  variant: DeathVariant;
  /** Display name for the memorial card. */
  label: string;
  /** Particle / ember count (instanced). */
  particles: number;
  /** Seconds the cinematic holds on screen. */
  durationMs: number;
  /** 0..1 slow-motion strength (0 = realtime). */
  slowmo: number;
  /** Whether to show the engraved brass memorial card. */
  memorialCard: boolean;
  /** Whether the flourish spans the whole screen (vs. a localized puff). */
  screenWide: boolean;
  /** Accent colour token used by the cinematic. */
  accent: 'ember' | 'brass' | 'gold';
}

const DEATH_SPECS: Record<DeathVariant, DeathVariantSpec> = {
  drifter: {
    variant: 'drifter',
    label: 'Drifter',
    particles: 24,
    durationMs: 1400,
    slowmo: 0,
    memorialCard: false,
    screenWide: false,
    accent: 'ember',
  },
  made: {
    variant: 'made',
    label: 'Made',
    particles: 60,
    durationMs: 1800,
    slowmo: 0.15,
    memorialCard: false,
    screenWide: false,
    accent: 'ember',
  },
  capo: {
    variant: 'capo',
    label: 'Capo',
    particles: 120,
    durationMs: 2000,
    slowmo: 0.3,
    memorialCard: true,
    screenWide: false,
    accent: 'brass',
  },
  boss: {
    variant: 'boss',
    label: 'Boss',
    particles: 220,
    durationMs: 2400,
    slowmo: 0.45,
    memorialCard: true,
    screenWide: true,
    accent: 'brass',
  },
  kingpin: {
    variant: 'kingpin',
    label: 'Kingpin',
    particles: 360,
    durationMs: 2800,
    slowmo: 0.6,
    memorialCard: true,
    screenWide: true,
    accent: 'gold',
  },
};

export function deathSpecForTier(tier: string | null | undefined): DeathVariantSpec {
  return DEATH_SPECS[deathVariantForTier(tier)];
}

/**
 * For *other* seats (whose tier we don't know), pick a cause-appropriate effect
 * at a modest, uniform scale. Purely cosmetic flavour over the death feed.
 */
export type CauseEffect = 'knife' | 'shot' | 'noose' | 'poison' | 'shroud';

export function effectForCause(cause: DeathCause): CauseEffect {
  switch (cause) {
    case 'mafia':
      return 'knife';
    case 'serial_killer':
      return 'knife';
    case 'vigilante':
    case 'bodyguard':
    case 'veteran':
      return 'shot';
    case 'lynch':
    case 'jailor_execute':
      return 'noose';
    case 'jester_grief':
      return 'poison';
    case 'leave':
    case 'admin':
      return 'shroud';
    default: {
      // Exhaustiveness guard: a new cause should force a decision here.
      const _never: never = cause;
      void _never;
      return 'shroud';
    }
  }
}
