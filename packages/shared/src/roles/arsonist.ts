import type { RoleDefinition } from './types.js';

export const ARSONIST: RoleDefinition = {
  id: 'ARSONIST',
  name: 'Arsonist',
  faction: 'NEUTRAL_KILLING',
  // Killing family: dousing visits the target; igniting is a self-action that
  // burns every doused soul at once. The engine drives both via `douse`/`ignite`.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others_or_self',
  unique: true,
  nightImmune: true,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R7',
  tagline: 'You work patient, with a can of kerosene and a single match.',
  description:
    'You answer to no one but the fire. Most nights you creep to a neighbor\'s house and douse ' +
    'it in oil — they never smell it, and you mark as many as you please across the nights. ' +
    'Then, on a night of your choosing, you stay home and strike the match: every soaked house ' +
    'in town goes up at once, and no doctor\'s hands nor hired guard can pull those people from ' +
    'the blaze. The dark does not touch you, and only the cell or the rope can put you out. ' +
    'Light the town up with the right names marked and you will be the last one standing.',
  winHint:
    'Win alone: be the last one standing who can still kill — see the Town and Mafia burned.',
};
