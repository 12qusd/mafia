import type { RoleDefinition } from './types.js';

export const MASS_MURDERER: RoleDefinition = {
  id: 'MASS_MURDERER',
  name: 'Mass Murderer',
  faction: 'NEUTRAL_KILLING',
  // Killing family: the engine drives the real behavior via the `massacre` night
  // ability — a slaughter at a chosen house.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: true,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R4',
  tagline: 'You do not pick a person. You pick a door, and kill everyone behind it.',
  description:
    'You are not a careful killer — you are a thorough one. Each night you let yourself into a ' +
    'house and put down whoever you find: the soul who lives there and every visitor unlucky ' +
    'enough to have called on them the same evening. The slaughter is total — no nurse and no ' +
    'bodyguard pulls anyone out of that room — and only the cell or a body that will not die ' +
    'escapes you. The dark cannot touch you in return. Pick a busy address and you may empty ' +
    'it in a single night; outlast everyone and the town is a graveyard with you in it.',
  winHint:
    'Win alone: be the last one standing who can still kill — empty the town house by house.',
};
