import type { RoleDefinition } from './types.js';

export const BODYGUARD: RoleDefinition = {
  id: 'BODYGUARD',
  name: 'Bodyguard',
  faction: 'TOWN',
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R7',
  tagline: 'Hired muscle who takes the bullet so you don\'t have to.',
  description:
    'You hire out as protection. Each night you may stand watch over one neighbor. If a killer ' +
    'comes for the soul you are guarding, you step into the blade — your ward walks away ' +
    'untouched, and you put the assailant down where they stand before you fall yourself. It is ' +
    'a straight trade: their life and yours for the one you swore to keep. A hardened killer ' +
    'may shrug off your last shot, but your ward lives all the same. Guard the wrong door and ' +
    'you simply waste a quiet night.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
