/**
 * Noir art-deco palette for the 3D layer, mirrored from theme.css so the
 * cinematic backdrop reads as one piece with the CSS chrome. These are plain
 * hex constants (three.js Color accepts them) — no WebGL is touched here, so
 * this module is import-safe under jsdom.
 */

export const PALETTE = {
  ink: '#0c0b10',
  inkDeep: '#07060d',
  brass: '#c9a45a',
  brassDim: '#8a763e',
  amber: '#e0b65c',
  blood: '#a3343a',
  bloodDim: '#732127',
  verdigris: '#3f7d6e',
  fog: '#2a2940',
  moon: '#e8e4d8',
  // Mood sky tints.
  nightSky: '#0b0c1f',
  nightHorizon: '#1d2347',
  dawnSky: '#241a22',
  dawnHorizon: '#caa15a',
  daySky: '#171522',
  dayHorizon: '#3a3450',
  gallowsSky: '#160b0f',
  gallowsHorizon: '#3a151a',
} as const;

export type MoodColors = {
  /** Top-of-sky colour. */
  sky: string;
  /** Horizon glow colour. */
  horizon: string;
  /** Key light colour. */
  key: string;
  /** Key light intensity. */
  keyIntensity: number;
  /** Ambient fill intensity. */
  ambient: number;
  /** Particle / atmosphere tint. */
  atmosphere: string;
  /** Whether the moon is visible. */
  moon: boolean;
  /** Whether the gallows motif is visible. */
  gallows: boolean;
};

import type { SceneMood } from '../../lib/anim.js';

export const MOOD_COLORS: Record<SceneMood, MoodColors> = {
  night: {
    sky: PALETTE.nightSky,
    horizon: PALETTE.nightHorizon,
    key: '#6f76c0',
    keyIntensity: 0.5,
    ambient: 0.22,
    atmosphere: PALETTE.fog,
    moon: true,
    gallows: false,
  },
  dawn: {
    sky: PALETTE.dawnSky,
    horizon: PALETTE.dawnHorizon,
    key: PALETTE.amber,
    keyIntensity: 1.15,
    ambient: 0.55,
    atmosphere: PALETTE.amber,
    moon: false,
    gallows: false,
  },
  day: {
    sky: PALETTE.daySky,
    horizon: PALETTE.dayHorizon,
    key: PALETTE.brass,
    keyIntensity: 0.85,
    ambient: 0.6,
    atmosphere: PALETTE.brassDim,
    moon: false,
    gallows: false,
  },
  gallows: {
    sky: PALETTE.gallowsSky,
    horizon: PALETTE.gallowsHorizon,
    key: PALETTE.blood,
    keyIntensity: 0.7,
    ambient: 0.3,
    atmosphere: PALETTE.bloodDim,
    moon: false,
    gallows: true,
  },
};
