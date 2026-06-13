import type { RoleDefinition } from './types.js';

export const JESTER: RoleDefinition = {
  id: 'JESTER',
  name: 'Jester',
  faction: 'NEUTRAL_BENIGN',
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'none',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R3',
  tagline: 'The last laugh belongs to the fool.',
  description:
    'You want the rope, and you want the town to tie it for you. You have no night action and ' +
    'no friends — your single, perverse ambition is to be voted up and executed by the very ' +
    'people you goad. Win that and the joke is on them: the night after your hanging, one of ' +
    'the souls who voted you guilty is found dead of grief, and no medicine or guard can stop ' +
    'it. The game goes on without you, but you have already won.',
  winHint: 'Win alone: provoke the town into executing you by daylight vote.',
};
