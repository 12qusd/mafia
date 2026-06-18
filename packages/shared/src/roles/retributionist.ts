import type { RoleDefinition } from './types.js';

export const RETRIBUTIONIST: RoleDefinition = {
  id: 'RETRIBUTIONIST',
  name: 'Retributionist',
  faction: 'TOWN',
  // Resurrection family: the engine drives the revive via the `retribute` night
  // ability — once per game, raise a dead Town soul back to life with their old
  // role intact. Not an investigation, not a kill — a one-time miracle.
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R2',
  tagline: 'The grave is not always the end — once, you can call one back.',
  description:
    'You keep an old and dangerous gift: the dead will answer you, but only once. On a single ' +
    'night of your choosing you may kneel at the grave of a fallen townsperson and call them ' +
    'back — they rise with breath in their lungs and their old craft intact, ready to take up ' +
    'the fight again. Choose your moment well, for the gift spends itself entirely the first ' +
    'time you use it. Only a true son or daughter of the town may be raised — the dark and the ' +
    'lone killers stay in the ground where they fell.',
  winHint: 'Win with the Town: see every threat to the streets put down for good.',
};
