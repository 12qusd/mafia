import type { RoleDefinition } from './types.js';

export const ESCORT: RoleDefinition = {
  id: 'ESCORT',
  name: 'Escort',
  faction: 'TOWN',
  nightAction: 'roleblock',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R5',
  tagline: 'A long evening that keeps a man off his work.',
  description:
    'Each night you may call on one neighbor and keep them occupied until dawn. Whatever ' +
    'they meant to do that night simply never happens — they wake to a wasted evening and a ' +
    'note that says only that they were kept distracted. Some men cannot be charmed off their ' +
    'task, and one guest is deadly to visit: spend the night with a lone cutthroat and you ' +
    'will not see the morning.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
