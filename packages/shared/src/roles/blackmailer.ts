import type { RoleDefinition } from './types.js';

export const BLACKMAILER: RoleDefinition = {
  id: 'BLACKMAILER',
  name: 'Blackmailer',
  faction: 'MAFIA',
  // Descriptive family: a support role that manipulates the day, not the kill.
  // The engine drives the real behavior via the `blackmail` night ability.
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R2',
  tagline: 'Everyone has a secret. You have all of them.',
  description:
    'You trade in the things people would rather keep buried. Each night you may call on one ' +
    'neighbor and remind them, quietly, of what you know. Come morning they dare not breathe a ' +
    'word — for the whole of the next day they are struck dumb in the town square, unable to ' +
    'speak, defend themselves, or point a finger. A silenced witness is a useful one: let the ' +
    'town hang someone who could not say a word in their own defense.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
