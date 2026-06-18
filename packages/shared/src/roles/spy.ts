import type { RoleDefinition } from './types.js';

export const SPY: RoleDefinition = {
  id: 'SPY',
  name: 'Spy',
  faction: 'TOWN',
  // The Spy takes no street visit — they sit in the dark and listen. The engine
  // drives the read via the `spy` self-ability (no target).
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'self',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R3',
  tagline: 'You keep an ear to the wall the family thinks is solid.',
  description:
    'You have a man on the inside, or close enough. Each night you sit quiet and listen, and ' +
    'by morning you can say which doors the family\'s people darkened — every house the Mafia ' +
    'paid a call on that night. You do not learn a single name or face, mind you, only the ' +
    'street numbers where their shadows fell. Read those numbers right and you can tell who the ' +
    'family wants dead and who they are watching. You go nowhere yourself, so no one sees you ' +
    'coming.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
