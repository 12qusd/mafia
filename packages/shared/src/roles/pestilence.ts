import type { RoleDefinition } from './types.js';

export const PESTILENCE: RoleDefinition = {
  id: 'PESTILENCE',
  name: 'Pestilence',
  faction: 'NEUTRAL_KILLING',
  // The Plaguebearer's final form (a conversion target, like the Jester an
  // Executioner becomes). A powerful lone killer: the engine drives the kill via
  // the `pestilence` night ability, a powerful attack that pierces basic defense.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  // Untouchable in the night — only the cell stays its hand.
  nightImmune: true,
  roleblockImmune: true,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R4',
  tagline: 'Pestilence rides, and the night belongs to ruin.',
  description:
    'The plague has finished its work and remade you. You are Pestilence now, Horseman of the ' +
    'apocalypse — no longer a quiet carrier but a force of ruin. Each night you bring death to ' +
    'a chosen soul with a blow that smashes through any doctor\'s care or hired guard. No knife ' +
    'in the dark can cut you, no distraction can stay you, and only the rope or the cell can ' +
    'end your ride. Sweep the survivors aside and the reckoning the plague promised is yours.',
  winHint:
    'Win alone: be the last one standing who can still kill — ride the survivors down.',
};
