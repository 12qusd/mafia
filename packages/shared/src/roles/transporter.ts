import type { RoleDefinition } from './types.js';

export const TRANSPORTER: RoleDefinition = {
  id: 'TRANSPORTER',
  name: 'Transporter',
  faction: 'TOWN',
  // Support role: it does not investigate, heal, or kill — it SWAPS two houses.
  // The engine drives the real behavior via the `transport` night ability, which
  // uses the optional second target (target2) to name the two seats to swap.
  nightAction: 'control',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R8',
  tagline: 'Two cabs, two fares, and a switch nobody sees in the dark.',
  description:
    'You run the only honest cab in a crooked town — honest, that is, about getting people ' +
    'where they did not mean to go. Each night you pick two neighbors and quietly swap them. ' +
    'Anyone who comes calling on the first finds the second instead, and the other way around: ' +
    'a healer mending one mends the other, a blade meant for one lands on the other, a watcher ' +
    'tailing one tails the other. The two you move still go about their own business as ' +
    'themselves — only the callers at their doors get turned around. Used well you can carry a ' +
    'killer\'s knife onto an empty bed, or a doctor\'s hand onto a dying friend.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
