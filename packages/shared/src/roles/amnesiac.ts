import type { RoleDefinition } from './types.js';

export const AMNESIAC: RoleDefinition = {
  id: 'AMNESIAC',
  name: 'Amnesiac',
  faction: 'NEUTRAL_BENIGN',
  // The "remember" action visits a dead seat (a graveside call). The engine
  // drives the conversion via the `remember` night ability.
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R1',
  tagline: 'You woke with empty pockets and no idea whose coat you were wearing.',
  description:
    'You came to in this town with no memory of who you were or whose side you took. You drift, ' +
    'harmless, until you decide to be otherwise. On a night you may kneel at a fresh grave and ' +
    'take up the dead one\'s trade as your own — from that morning you ARE what they were, with ' +
    'all that comes with it, for good or ill. You cannot borrow a one-of-a-kind office still ' +
    'held by a living soul, and you will not stoop to the schemers\' games. Until you remember, ' +
    'you want only to be standing when the dust settles.',
  winHint:
    'Win by surviving until the end if you never remember; otherwise, win with whatever you become.',
};
