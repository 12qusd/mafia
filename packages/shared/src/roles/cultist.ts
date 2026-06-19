import type { RoleDefinition } from './types.js';

/**
 * Cultist — the converted body of the Cult conversion faction (BUILD_SPEC §6.5;
 * Cult faction).
 *
 * A Cultist is one the Cult Leader has drawn in. They have no power of their own:
 * they do not kill, they do not recruit, they simply belong — one more body in the
 * count, one more vote, one more pair of hands when the faithful finally outnumber
 * the rest. Like every member of the Cult they keep no roll call and are never told
 * who the others are, so a Cultist found out gives nothing away but themselves. A
 * seat almost never STARTS as a Cultist — this is the shape a recruit takes when
 * the Leader's work succeeds (a role + faction change, mirroring the Vampire turn).
 *
 * DECISION (DECISIONS.md "Cult conversion faction"): the Cultist has NO night
 * ability (only the Cult Leader recruits); it reads sheriff-suspicious and
 * investigator-R1; it is knowledge-isolated (no chat, no roster) like the rest of
 * the Cult.
 */
export const CULTIST: RoleDefinition = {
  id: 'CULTIST',
  name: 'Cultist',
  faction: 'CULT',
  // No night ability — a Cultist cannot recruit (only the Leader can) and cannot
  // kill. It exists to swell the parity count.
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'none',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'suspicious',
  // R1: a fresh convert reads like an ordinary soul (Citizen / Survivor / etc.).
  investigatorClass: 'R1',
  tagline: 'One more in the count, sworn and silent.',
  description:
    'You were an ordinary soul, until a voice in the dark drew you in. Now you belong to the ' +
    'Cult — you have no power to kill and none to recruit, only to stand with the faithful and ' +
    'wait for the day your numbers swallow the rest. You do not know who the others are, and they ' +
    'do not know you, so if you are found out you betray no one but yourself.',
  winHint: 'Win with the Cult: stand with the faithful until your numbers outweigh everyone left.',
};
