import type { RoleDefinition } from './types.js';
import { MEDIUM_SEANCES } from '../constants.js';

export const MEDIUM: RoleDefinition = {
  id: 'MEDIUM',
  name: 'Medium',
  faction: 'TOWN',
  // The séance is selected by day (like the Jailor's jail) and resolves at night.
  // Marked as a passive day-driven role here; the engine drives it via `seance`.
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'none',
  uses: { total: MEDIUM_SEANCES },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R4',
  tagline: 'You keep a chair empty at the table for the ones who already left it.',
  description:
    'The dead still have plenty to say, and you are the one who can hear it. Once in a game, ' +
    'while you still draw breath, you may hold a séance: for a single night the buried can speak ' +
    'with you and you with them, trading what they learned in life for what you can do with it. ' +
    'They know your seat at the table but never your trade, and not a word of that night reaches ' +
    'the living who were not invited. Spend your one séance well — choose the night the ' +
    'graveyard holds someone worth raising.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
