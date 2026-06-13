import type { RoleDefinition } from './types.js';

export const CONSORT: RoleDefinition = {
  id: 'CONSORT',
  name: 'Consort',
  faction: 'MAFIA',
  nightAction: 'roleblock',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R5',
  tagline: 'A charming evening that serves the family.',
  description:
    'You work for the outfit by keeping the right people busy. Each night you may occupy one ' +
    'neighbor so thoroughly that their own plans never get off the ground — they lose the ' +
    "night to your company. It is the same trick the town's escort runs, turned to crooked " +
    'ends, and it carries the same danger: entertain a lone cutthroat and you will be found ' +
    'cold come morning.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
