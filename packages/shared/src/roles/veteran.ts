import type { RoleDefinition } from './types.js';
import { VETERAN_ALERTS } from '../constants.js';

export const VETERAN: RoleDefinition = {
  id: 'VETERAN',
  name: 'Veteran',
  faction: 'TOWN',
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'self',
  uses: { total: VETERAN_ALERTS },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R6',
  tagline: 'An old soldier who sleeps with one eye open and a shotgun loaded.',
  description:
    'You came home from the war and never quite left it behind. A few nights in a game you may ' +
    'go on alert: bar the door, sit up in the dark, and put down anyone who comes calling. On ' +
    'an alert night nothing reaches you — no blade, no charm, no distraction — and every soul ' +
    'who steps onto your porch, friend or foe, eats lead. Be careful whom you frighten: a ' +
    'doctor or a nosy neighbor who meant no harm dies just the same. A hardened killer may ' +
    'survive your volley, but they will know you were ready. Sit quiet on the nights you do not ' +
    'alert, and you are as vulnerable as anyone.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
