import type { RoleDefinition } from './types.js';

export const PIRATE: RoleDefinition = {
  id: 'PIRATE',
  name: 'Pirate',
  faction: 'NEUTRAL_BENIGN',
  // Duel family: the engine drives the real behavior via the `duel` night ability.
  // The Pirate picks one of three deterministic attacks; the duel is decided by the
  // seeded PRNG against a fixed rule. A dueled target is "plundered" — occupied for
  // the night (roleblocked) and untouchable by any other kill, but survives.
  nightAction: 'roleblock',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  // The Pirate is a brawler, not a target — but not night-immune; only the cell
  // (jail) keeps him from a duel.
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R6',
  tagline: 'Pick your blow, win the duel, and the plunder is yours.',
  description:
    'You sailed into this town looking for a fight, and you mean to win enough of them to make ' +
    'a name. Each night you call out one soul and force a duel — choosing how you come at them: ' +
    'a straight thrust, a wild swing, or a feint. Cross blades with the right read and you land ' +
    'a successful plunder; whoever you duel is occupied all night, kept from acting and shielded ' +
    'from every other knife in the dark — they wake unharmed, but they wake having lost the ' +
    'night. Land enough plunders and live to see the end, and the spoils — and the glory — are ' +
    'yours alone.',
  winHint:
    'Win alone: land enough successful plunders and be alive at the end, no matter who else wins.',
};
