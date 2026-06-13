import type { RoleDefinition } from './types.js';
import { JAILOR_EXECUTIONS } from '../constants.js';

export const JAILOR: RoleDefinition = {
  id: 'JAILOR',
  name: 'Jailor',
  faction: 'TOWN',
  // The jailor's defining choice (whether to execute) happens at night, but the
  // prisoner is chosen during the day via `day_ability` (jail).
  nightAction: 'kill',
  dayAction: 'jail',
  targetScope: 'others',
  uses: { total: JAILOR_EXECUTIONS },
  unique: true,
  nightImmune: false,
  roleblockImmune: false,
  // Hauling someone to a cell is not a street visit the Lookout can read.
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R2',
  tagline: 'One cell, one key, and a hard decision.',
  description:
    'By day you may name one neighbor and have them dragged to a holding cell for the coming ' +
    'night. A prisoner does nothing and reaches no one — they are sealed off from every visit, ' +
    'good or ill, and shielded even from a killer at the door. Behind the bars you may trade ' +
    'words with them, your own name kept hidden. Twice in a game you may decide a prisoner ' +
    "has earned the rope; that sentence cuts through any charm, armor, or doctor's hand. " +
    'You cannot jail anyone on the first day.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
