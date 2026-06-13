import type { RoleDefinition } from './types.js';
import { SURVIVOR_VESTS } from '../constants.js';

export const SURVIVOR: RoleDefinition = {
  id: 'SURVIVOR',
  name: 'Survivor',
  faction: 'NEUTRAL_BENIGN',
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'self',
  uses: { total: SURVIVOR_VESTS, selfTotal: SURVIVOR_VESTS },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  // Putting on your own vest is not a visit to anyone.
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R1',
  tagline: 'No cause but your own skin.',
  description:
    'You picked no side and you mean to keep it that way. Stashed away you have four bulletproof ' +
    'vests; on any night you choose you may strap one on and shrug off a killer who comes for ' +
    'you, though each vest is good for one night only. You hold no grudge and chase no kill — ' +
    'your whole ambition is to be standing when the smoke clears, and you share in the victory ' +
    'of whoever wins.',
  winHint: 'Win by simply being alive when the game ends, beside whichever side prevails.',
};
