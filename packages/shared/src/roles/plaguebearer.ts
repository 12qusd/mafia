import type { RoleDefinition } from './types.js';

export const PLAGUEBEARER: RoleDefinition = {
  id: 'PLAGUEBEARER',
  name: 'Plaguebearer',
  faction: 'NEUTRAL_KILLING',
  // Killing family (conversion): the engine drives the spread via the `infect`
  // night ability — a visit that infects. Anyone the Plaguebearer visits, and
  // anyone who visits the Plaguebearer, catches the sickness. When every living
  // soul is infected, the Plaguebearer transforms into Pestilence.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  // Carries the sickness but is not yet a night-immune horror — that comes with
  // the transformation into Pestilence.
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R4',
  tagline: 'You carry a sickness, and the whole town is going to share it.',
  description:
    'You are patient zero. You cannot be cured and you do not bleed like the others — instead ' +
    'you spread. Each night you call on a neighbor and leave your contagion behind; anyone who ' +
    'comes calling on you catches it too, and the sickness creeps outward from every soul it ' +
    'touches. You take no lives directly — not yet. But when the last healthy heart in town ' +
    'finally falls ill and every living soul is infected, the plague consumes you and remakes ' +
    'you into Pestilence, Horseman of death, who walks the night untouchable and rains ruin on ' +
    'the survivors. Infect them all, and the reckoning is yours.',
  winHint:
    'Win alone: infect every living soul to become Pestilence, then be the last killer standing.',
};
