import type { RoleDefinition } from './types.js';

export const HYPNOTIST: RoleDefinition = {
  id: 'HYPNOTIST',
  name: 'Hypnotist',
  faction: 'MAFIA',
  // Deception support: plants a false memory of the night in a target. No real
  // mechanical effect. The engine drives it via the `hypnotize` night ability.
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R5',
  tagline: 'You decide what they remember of the night — whether or not it happened.',
  description:
    'You work on the mind, not the body. Each night you may slip into one neighbor\'s dreams ' +
    'and plant a memory that never happened — come morning they wake certain that someone tied ' +
    'them up, or that a knife found them in the dark and missed. None of it is real; their ' +
    'night went exactly as it would have. But a soul chasing a phantom roleblocker, or ' +
    'shouting that they were attacked, hands the town a false lead and points fingers at the ' +
    'innocent. Confusion is the family\'s best alibi.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
