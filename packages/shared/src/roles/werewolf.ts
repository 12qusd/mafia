import type { RoleDefinition } from './types.js';

export const WEREWOLF: RoleDefinition = {
  id: 'WEREWOLF',
  name: 'Werewolf',
  faction: 'NEUTRAL_KILLING',
  // Killing family: the engine drives the real behavior via the `rampage` night
  // ability, which only bites on full-moon nights.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others_or_self',
  unique: true,
  nightImmune: true,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R6',
  tagline: 'Most nights you pass for a neighbor. On the wrong nights you do not.',
  description:
    'You carry a curse that answers to the moon. When it hangs full you cannot keep the beast ' +
    'caged — you tear out into the dark and savage the house you pick, and any fool who came ' +
    'calling on YOUR door that same night is torn apart beside them. No locked door, no doctor, ' +
    'and no hired guard stops a thing that size; only a cell or a soul too cold to die walks ' +
    'away. On the duller nights between, the beast sleeps and you stay home, harmless and ' +
    'unsuspected. Outlast the town and the family, and the streets are yours alone.',
  winHint:
    'Win alone: be the last one standing who can still kill — see the Town and Mafia torn down.',
};
