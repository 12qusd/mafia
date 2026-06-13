import type { RoleDefinition } from './types.js';

export const LOOKOUT: RoleDefinition = {
  id: 'LOOKOUT',
  name: 'Lookout',
  faction: 'TOWN',
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others_or_self',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R8',
  tagline: 'Eyes on a doorway all night long.',
  description:
    'Each night you may park yourself across the street from one house and note every ' +
    'caller who comes to that door. At dawn you learn which neighbors visited the seat you ' +
    'watched — including yourself, if you watch your own door. You see who actually arrived ' +
    'after the dust settles, so a caller who was waylaid or locked up never shows. Pair a ' +
    'visit list with a dead body and you may have found a killer.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
