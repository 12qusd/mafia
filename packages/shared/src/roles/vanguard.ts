import type { RoleDefinition } from './types.js';

/**
 * Vanguard — the Triad's support role (BUILD_SPEC §6.5; Triad faction). A
 * roleblocker: the Consort's mirror for the Triad. Occupies a neighbor for the
 * night so their plans never get off the ground. Reads suspicious; not immune.
 *
 * DECISION: the Triad support is a ROLEBLOCKER (mirrors the Consort), not a
 * framer — recorded in DECISIONS.md "Triad faction".
 */
export const VANGUARD: RoleDefinition = {
  id: 'VANGUARD',
  name: 'Vanguard',
  faction: 'TRIAD',
  nightAction: 'roleblock',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R5',
  tagline: 'The watcher who keeps the wrong door shut.',
  description:
    'You serve the tong by making sure the right people stay idle. Each night you may keep one ' +
    'neighbor so occupied that their own designs come to nothing — they lose the night to you. ' +
    "It is the same art the town's escort plies, bent to the brotherhood's ends, and it carries " +
    'the same risk: keep a lone cutthroat company and you will be found cold at first light.',
  winHint: 'Win with the Triad: hold the streets until no rival faction can vote you down.',
};
