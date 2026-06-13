import type { RoleDefinition } from './types.js';

export const GODFATHER: RoleDefinition = {
  id: 'GODFATHER',
  name: 'Godfather',
  faction: 'MAFIA',
  // The Godfather directs the kill; he only personally visits when no Mafioso
  // lives, which the engine models as a kill state, not a base flag.
  nightAction: 'control',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  nightImmune: true,
  roleblockImmune: true,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R7',
  tagline: 'The hand that never holds the knife.',
  description:
    'You run the outfit. Each night the family settles on a target in private, and yours is ' +
    'the final word on who falls. You stay clean: a sheriff finds nothing on you, a long ' +
    'evening cannot keep you from your business, and ordinary violence in the dark slides ' +
    'right off you. You give the order from your study and never dirty your own hands — unless ' +
    'every soldier under you is gone, in which case you must walk to the door yourself.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
