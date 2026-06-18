import type { RoleDefinition } from './types.js';

export const PSYCHIC: RoleDefinition = {
  id: 'PSYCHIC',
  name: 'Psychic',
  faction: 'TOWN',
  // Information role: each night a vision arrives unbidden. No street visit — the
  // Psychic stays home. The engine drives the read via the `divine` self-ability.
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'self',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R3',
  tagline: 'The cards never lie — though they rarely speak plainly.',
  description:
    'You read what others cannot see. Each night a vision settles over you: a handful of your ' +
    'neighbors swim into focus, and you know — bone-deep — that at least one of them carries ' +
    'darkness in their heart. On other nights the vision turns the other way, and you know at ' +
    'least one of the faces is true and good. The cards never name which one, only the company ' +
    'they keep. Read the pattern across many nights and the truth takes shape. You go nowhere ' +
    'to learn it; the sight comes to you.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
