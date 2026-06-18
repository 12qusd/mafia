import type { RoleDefinition } from './types.js';

/**
 * Vampire — the conversion faction's biter (BUILD_SPEC §6.5; Vampire faction).
 *
 * Vampires do not kill: they win by TURNING the living. Each night a vampire may
 * bite a neighbor; a successful bite drags a townsperson (or a wandering neutral)
 * into the coven as a new Vampire. The brood swells until it outnumbers what is
 * left of the living and the town is theirs. Crucially the vampires keep no roll
 * call — each one hunts alone and is never told who the others are (so a fresh
 * convert betrays no one). Their one fear is the Vampire Hunter, whose ward turns
 * a bite into a stake through the heart.
 *
 * DECISION (DECISIONS.md "Vampire conversion faction"): knowledge-isolated — NO
 * vampire chat, NO roster; classic (not night-immune); conversion is the entire
 * win condition (no fallback kill); only ONE bite resolves per night (the
 * lowest-seat living vampire); only TOWN / NEUTRAL_BENIGN seats are convertible.
 */
export const VAMPIRE: RoleDefinition = {
  id: 'VAMPIRE',
  name: 'Vampire',
  faction: 'VAMPIRE',
  // The bite is a visiting conversion attempt (a kill-family slot mechanically,
  // but it turns rather than kills). Surfaced to the engine as the `bite` ability.
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  // Classic vampires are NOT night-immune (recorded). A Vigilante/SK/etc. can end
  // one in the night like anyone else.
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R4',
  tagline: 'A thirst that only spreads.',
  description:
    'You do not kill — you recruit. Each night you may sink your teeth into one neighbor, and ' +
    'if they are an ordinary soul they rise before dawn as one of your own, bound to the same ' +
    'hunger. You hunt alone and know none of the others by name, so no fresh convert can ever ' +
    'give the coven away. Beware the one who hunts your kind: bite the wrong throat and you will ' +
    'find a stake waiting where a pulse should be.',
  winHint:
    'Win with the Vampires: turn the living until your kind outnumber everyone left standing.',
};
