import type { RoleDefinition } from './types.js';

/**
 * Cult Leader — the Cult conversion faction's one and only recruiter (BUILD_SPEC
 * §6.5; Cult faction).
 *
 * The Cult Leader does not kill. They preach in the dark, and one by one the
 * living are drawn in. Each night the Leader may reach for a single soul; if it is
 * an ordinary one — a townsperson or a wandering neutral — it wakes the next
 * morning as a Cultist, sworn and silent. But the work is patient: the Leader
 * cannot recruit two nights running (a one-night rest after each conversion), and
 * the moment the Leader is gone the conversions stop forever — a headless flock
 * can hold a room by numbers, but it can no longer grow. Like the coven before it,
 * the Cult keeps no roll call: every member walks alone and never learns who the
 * others are, so no fresh convert can give the rest away.
 *
 * DECISION (DECISIONS.md "Cult conversion faction"): knowledge-isolated — NO cult
 * chat, NO roster; ONLY the (unique) Cult Leader recruits; a one-night cooldown
 * between recruits; recruitment STOPS when the Leader dies; convertible = living
 * TOWN / NEUTRAL_BENIGN, non-immune, not already Cult; NOT night-immune (the town
 * counters by killing/lynching the Leader); conversion + parity is the whole win
 * condition (no cult kill).
 */
export const CULT_LEADER: RoleDefinition = {
  id: 'CULT_LEADER',
  name: 'Cult Leader',
  faction: 'CULT',
  // The recruitment is a visiting conversion attempt (a kill-family slot
  // mechanically, like the Vampire's bite, but it converts rather than kills).
  // Surfaced to the engine as the `recruit` ability (see roleinfo.ts).
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  // Exactly one Cult Leader per game: it is the sole recruiter, and its death ends
  // all conversion.
  unique: true,
  // NOT night-immune (recorded). A Vigilante/SK/etc. can end the Leader in the
  // night like anyone else — and that is precisely the town's counter.
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  // R1: hides among the soft Town/benign reads (Citizen, Survivor, Executioner,
  // Amnesiac, Guardian Angel) so a single investigation never confirms the Leader.
  investigatorClass: 'R1',
  tagline: 'A patient voice, and a flock that only grows.',
  description:
    'You do not kill — you gather. Each night you may reach for one soul, and if they are an ' +
    'ordinary one they wake sworn to you, a Cultist among the faithful. The work is patient: you ' +
    'must rest the night after each conversion, and you alone can bring others in — should you ' +
    'fall, the flock can still hold a room by sheer numbers, but it will never grow again. You ' +
    'keep no list of the converted and they keep none of you, so no one taken can ever name the ' +
    'rest. Your one weakness is being found out: a stake, a noose, a bullet — and the gathering ends.',
  winHint:
    'Win with the Cult: draw the living into the faithful until your numbers swallow everyone left.',
};
