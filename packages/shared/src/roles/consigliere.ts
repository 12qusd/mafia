import type { RoleDefinition } from './types.js';

export const CONSIGLIERE: RoleDefinition = {
  id: 'CONSIGLIERE',
  name: 'Consigliere',
  faction: 'MAFIA',
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R3',
  tagline: 'The boss\'s ear, and the man who knows everyone\'s name.',
  description:
    'You are the family\'s counsel, and your trade is certainty. Each night you may call ' +
    'quietly on one neighbor and come away knowing exactly what they are — not a shortlist, ' +
    'not a hunch, but their true trade named plainly. Carry that word back to your people and ' +
    'they will know precisely who to cut down and who to leave for the rope. Take care, ' +
    'though — a sheriff still smells the family on you.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
