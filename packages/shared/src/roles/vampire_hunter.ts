import type { RoleDefinition } from './types.js';

/**
 * Vampire Hunter — the Town's answer to the coven (BUILD_SPEC §6.5; Vampire
 * faction counter).
 *
 * The Hunter keeps a sharpened stake by the bed. Any vampire who comes to bite
 * the Hunter in the night is staked through the heart and dies on the spot
 * (passive ward). The Hunter may also actively check a neighbor and learn whether
 * they are a vampire — a plain "vampire / not a vampire" read (the classic-simpler
 * variant; recorded). Once every vampire in the game is gone the Hunter's purpose
 * is spent: with no coven left to fight, the Hunter takes up a pistol and becomes
 * a Vigilante (role change, mirroring the Executioner → Jester conversion).
 *
 * DECISION (DECISIONS.md "Vampire conversion faction"): the active ability is a
 * CHECK (learn vampire/not), not a kill; the kill happens only reactively, when a
 * vampire bites the Hunter (death cause `staked`).
 */
export const VAMPIRE_HUNTER: RoleDefinition = {
  id: 'VAMPIRE_HUNTER',
  name: 'Vampire Hunter',
  faction: 'TOWN',
  // The active ability is an investigation (check the target for vampirism); the
  // passive stake of a biting vampire is resolved by the engine, not a target.
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R2',
  tagline: 'A stake, a steady hand, and one job.',
  description:
    'You know the signs of the undead, and you keep a stake to hand. Each night you may study ' +
    'one neighbor and learn for certain whether the curse runs in their veins. And should a ' +
    'vampire come to your door to turn you, they will find the point of your stake instead — ' +
    'they die where they stand. When the last of their kind is finally in the ground, your ' +
    'long hunt is over; you set down the stake, take up a pistol, and go on guarding the town.',
  winHint: 'Win with the Town: see the coven staked out and every other killer buried.',
};
