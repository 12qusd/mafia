import type { RoleDefinition } from './types.js';

/**
 * Dragon Head — the Triad's Godfather-equivalent (BUILD_SPEC §6.5; Triad
 * faction). Structurally identical to the Godfather: directs the faction kill
 * from the shadows, is night-immune, reads clean to a sheriff, and only walks to
 * the door himself when no Enforcer survives.
 */
export const DRAGON_HEAD: RoleDefinition = {
  id: 'DRAGON_HEAD',
  name: 'Dragon Head',
  faction: 'TRIAD',
  // Directs the kill; only personally visits when no Enforcer lives, which the
  // engine models as a kill state, not a base flag (mirrors the Godfather).
  nightAction: 'control',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: true,
  roleblockImmune: true,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R7',
  tagline: 'The mountain master who speaks only once.',
  description:
    'You sit at the head of the tong. Each night the brotherhood chooses where the hatchet ' +
    'falls, and your word closes the matter. You keep your hands spotless: a sheriff turns up ' +
    'nothing, no long evening keeps you from the ledger, and common violence in the dark finds ' +
    'no purchase on you. You give the order and never leave your rooms — unless every hatchet ' +
    'man beneath you is dead, in which case you must answer the door yourself.',
  winHint: 'Win with the Triad: hold the streets until no rival faction can vote you down.',
};
