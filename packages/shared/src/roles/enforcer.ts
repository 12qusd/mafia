import type { RoleDefinition } from './types.js';

/**
 * Enforcer — the Triad's Mafioso-equivalent (BUILD_SPEC §6.5; Triad faction).
 * Carries out the Triad kill, reads suspicious to a sheriff, and can be
 * roleblocked. Succeeds to the leadership when the Dragon Head and the last
 * Enforcer are both gone (mirrors mafia succession).
 */
export const ENFORCER: RoleDefinition = {
  id: 'ENFORCER',
  name: 'Enforcer',
  faction: 'TRIAD',
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R6',
  tagline: 'The hatchet man who answers the call.',
  description:
    'You are the blade of the brotherhood. Each night you go to whoever the tong has marked ' +
    'and see the debt collected — the master may overrule your choice, and his call stands. ' +
    'Alone you are nothing special: a long evening can keep you home, and a sheriff will read ' +
    'the blood on your hands. Should the master fall with no other blade left, the tong will ' +
    'press a survivor into the work, and the killing falls to them.',
  winHint: 'Win with the Triad: hold the streets until no rival faction can vote you down.',
};
