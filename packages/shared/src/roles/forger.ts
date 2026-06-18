import type { RoleDefinition } from './types.js';

export const FORGER: RoleDefinition = {
  id: 'FORGER',
  name: 'Forger',
  faction: 'MAFIA',
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R8',
  tagline: 'A steady hand and a pen that lies for a living.',
  description:
    'You forge the paperwork the dead leave behind. Each night you may visit one neighbor and ' +
    'plant a counterfeit will on them — words you prepared in advance. Should that neighbor ' +
    'turn up dead by morning, it is your forgery the town reads aloud over the body, not ' +
    'whatever truth they meant to leave. Sow the wrong name, point the rope at an innocent, ' +
    'and bury the family\'s secrets with the corpse. If your mark lives, your ink is wasted ' +
    'for the night. Prepare the forged will where you keep your calling card.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
