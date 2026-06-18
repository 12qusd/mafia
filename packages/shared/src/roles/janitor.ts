import type { RoleDefinition } from './types.js';
import { JANITOR_CLEANS } from '../constants.js';

export const JANITOR: RoleDefinition = {
  id: 'JANITOR',
  name: 'Janitor',
  faction: 'MAFIA',
  // Descriptive family: a support role that manipulates what the body reveals.
  // The engine drives the real behavior via the `clean` night ability.
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  uses: { total: JANITOR_CLEANS },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R5',
  tagline: 'The family\'s mop, and the reason some bodies have no story.',
  description:
    'You make the messes disappear. A few times in a game you may mark one neighbor before the ' +
    'night\'s work. Should the family\'s knife find that very person, you reach the scene first ' +
    'and scrub it bare — the town buries a nameless corpse, learning neither what they were nor ' +
    'what they meant to leave behind. You alone read the papers before they burn, so you carry ' +
    'their secret out with you. Your rag is wasted if the family kills someone else, or kills ' +
    'no one at all.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
