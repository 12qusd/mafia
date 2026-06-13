import type { RoleDefinition } from './types.js';
import { VIGILANTE_BULLETS } from '../constants.js';

export const VIGILANTE: RoleDefinition = {
  id: 'VIGILANTE',
  name: 'Vigilante',
  faction: 'TOWN',
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  uses: { total: VIGILANTE_BULLETS },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R6',
  tagline: 'A private citizen with two bullets and a grudge.',
  description:
    'You keep a pistol and the conviction that the law is too slow. On a night of your ' +
    'choosing you may put a bullet in one neighbor — you have two, and no more. Be certain: ' +
    'gun down an honest townsman and you carry that weight. You will not fire on the very ' +
    'first night, while the town is still strangers to one another.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
