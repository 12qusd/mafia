import type { RoleDefinition } from './types.js';

export const DISGUISER: RoleDefinition = {
  id: 'DISGUISER',
  name: 'Disguiser',
  faction: 'MAFIA',
  // Deception family: the Disguiser visits a dead seat to assume its appearance.
  // The engine drives the overlay via the `disguise` night ability.
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R8',
  tagline: 'You wear a dead man\'s name like a borrowed coat.',
  description:
    'You are the family\'s quick-change artist. On a night you may slip to a fresh grave and ' +
    'take the dead one\'s face for your own papers — from then on, anyone who investigates you ' +
    'reads them, not you, and should you fall, the town buries you under the borrowed name and ' +
    'learns nothing of the family. Your true loyalties and your true ambitions never change, ' +
    'only the mask you show the law. Pick a corpse whose name will throw the hounds off the ' +
    'family\'s scent.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
