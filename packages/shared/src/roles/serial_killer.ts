import type { RoleDefinition } from './types.js';

export const SERIAL_KILLER: RoleDefinition = {
  id: 'SERIAL_KILLER',
  name: 'Serial Killer',
  faction: 'NEUTRAL_KILLING',
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: true,
  // Not blockable in effect: anyone who tries to occupy the killer dies in
  // place of the chosen target. The engine implements the redirect; the role is
  // not marked roleblockImmune so that the hazard rule applies (§6.7).
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R4',
  tagline: 'A private appetite, answering to no one.',
  description:
    'You work alone and you work in blood. Each night you may cut down one neighbor. The dark ' +
    'does not touch you — ordinary night killers cannot finish you. Anyone foolish enough to ' +
    'come and keep you company finds the knife instead: they die in place of whoever you had ' +
    'chosen, who lives to see another day. Only the law in a cell or the rope by daylight can ' +
    'end you.',
  winHint:
    'Win alone: be the last one standing who can still kill — see the Town and Mafia buried.',
};
