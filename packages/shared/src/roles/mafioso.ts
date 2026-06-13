import type { RoleDefinition } from './types.js';

export const MAFIOSO: RoleDefinition = {
  id: 'MAFIOSO',
  name: 'Mafioso',
  faction: 'MAFIA',
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R6',
  tagline: 'The soldier who carries out the sentence.',
  description:
    'You are the knife of the family. Each night you go to whoever the outfit has marked and ' +
    'see the work done — the boss may overrule your choice, and his call stands. You are no ' +
    'one special on your own: a long evening can keep you home, and a sheriff will smell the ' +
    'blood on you. Should the boss fall and no other soldier remain, the family will hand the ' +
    'reins to a survivor, and the killing falls to them.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
