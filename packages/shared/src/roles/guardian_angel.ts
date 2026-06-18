import type { RoleDefinition } from './types.js';

export const GUARDIAN_ANGEL: RoleDefinition = {
  id: 'GUARDIAN_ANGEL',
  name: 'Guardian Angel',
  faction: 'NEUTRAL_BENIGN',
  // Protective family: the engine drives the real behavior via the `shield` night
  // ability, which can only ward the one charge assigned at the start of the game.
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R1',
  tagline: 'One soul to watch over, and nothing else in this world matters to you.',
  description:
    'Fate has tied you to a single person — your charge — and your whole purpose is to see ' +
    'them through to the end alive. Each night you may keep watch over them and turn aside one ' +
    'blade meant for their back, the way a doctor would. You pick no side in the town\'s quarrels ' +
    'and chase no kill of your own; if your charge is still breathing when the dust settles, ' +
    'you have won, whoever else falls. But should they die despite you, your purpose is spent — ' +
    'you become a Survivor, with nothing left to do but save your own skin.',
  winHint: 'Win alone: keep your assigned charge alive until the game ends.',
};
