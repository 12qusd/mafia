import type { RoleDefinition } from './types.js';

export const CITIZEN: RoleDefinition = {
  id: 'CITIZEN',
  name: 'Citizen',
  faction: 'TOWN',
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'none',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R1',
  tagline: 'An ordinary face in a crooked town.',
  description:
    'You hold no badge, no pistol, no special trade — only your wits and your vote. ' +
    'You have no night action. Your work is done in the daylight: listen to the claims, ' +
    'weigh who rings false, and help the honest folk drag the rot into the open before it ' +
    'buries you all. Because anyone can claim to be a Citizen, your plainness is also your ' +
    'cover — and a liar may try to hide behind it.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
