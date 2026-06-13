import type { RoleDefinition } from './types.js';

export const INVESTIGATOR: RoleDefinition = {
  id: 'INVESTIGATOR',
  name: 'Investigator',
  faction: 'TOWN',
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R3',
  tagline: 'A patient eye that reads the small print.',
  description:
    'Each night you may dig into one neighbor and come away with a shortlist — a handful of ' +
    'trades any of which could fit what you found. You never get a clean name, only a ' +
    'cluster of possibilities, so your value is in cross-checking what people swear they are ' +
    'against what the evidence allows. A framer can salt your findings to make an honest ' +
    'neighbor look like hired muscle for the night.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
