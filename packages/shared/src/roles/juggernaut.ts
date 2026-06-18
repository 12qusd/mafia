import type { RoleDefinition } from './types.js';

export const JUGGERNAUT: RoleDefinition = {
  id: 'JUGGERNAUT',
  name: 'Juggernaut',
  faction: 'NEUTRAL_KILLING',
  // Killing family: the engine drives the real behavior via the `juggernaut` night
  // ability, which grows in power with every kill the seat lands.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: true,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R6',
  tagline: 'Every kill leaves you stronger, and you have no intention of stopping.',
  description:
    'You are a brawler who feeds on blood. At first you are slow to wake — you can only strike ' +
    'on the full-moon nights — but every life you take makes you harder to stop. Once your hands ' +
    'have found their first kill, the moon no longer holds you back and you may strike on any ' +
    'night. Take enough lives and your blows turn savage: they smash through a doctor\'s care and ' +
    'a hired guard alike, and anyone who came calling on your victim that night goes down with ' +
    'them. The dark cannot harm you, and only a cell stays your hand. Carve your way to the end ' +
    'and the town belongs to you alone.',
  winHint:
    'Win alone: be the last one standing who can still kill — grow stronger with every body.',
};
