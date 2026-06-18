/**
 * Role → engine ability mapping and `your_role` / ability-info construction.
 *
 * The protocol's `night_action.ability` is a free-form string the server
 * validates; the engine works in concrete {@link NightAbility} keys. This module
 * maps a seat's role to its night ability key (so the server can translate a
 * generic "act" command), and builds the per-seat `your_role` effect with the
 * mafia roster delivered only to mafia (§5).
 */

import {
  type RoleId,
  type SeatId,
  type Effect,
  ROLES,
  PROTOCOL_VERSION,
  VIGILANTE_BULLETS,
  JAILOR_EXECUTIONS,
  SURVIVOR_VESTS,
} from '@nocturne/shared';
import type { AbilityInfo } from '@nocturne/shared';
import type { GameState, NightAbility, SeatState } from './state.js';

/** The concrete night ability a role submits (or null for passive roles). */
export function roleToNightAbility(role: RoleId): NightAbility | null {
  switch (role) {
    case 'SHERIFF':
      return 'investigate_sheriff';
    case 'INVESTIGATOR':
      return 'investigate_investigator';
    case 'CONSIGLIERE':
      return 'investigate_consigliere';
    case 'LOOKOUT':
      return 'watch';
    case 'TRACKER':
      return 'investigate_track';
    case 'SPY':
      return 'spy';
    case 'AMNESIAC':
      return 'remember';
    case 'DOCTOR':
      return 'protect';
    case 'BODYGUARD':
      return 'guard';
    case 'CRUSADER':
      return 'crusade';
    case 'AMBUSHER':
      return 'ambush';
    case 'PSYCHIC':
      return 'divine';
    case 'HYPNOTIST':
      return 'hypnotize';
    case 'WEREWOLF':
      return 'rampage';
    case 'MASS_MURDERER':
      return 'massacre';
    case 'GUARDIAN_ANGEL':
      return 'shield';
    case 'JUGGERNAUT':
      return 'juggernaut';
    case 'SURVIVOR':
      return 'vest';
    case 'ESCORT':
    case 'CONSORT':
      return 'roleblock';
    case 'VIGILANTE':
      return 'kill_vigilante';
    case 'VETERAN':
      return 'alert';
    case 'MAFIOSO':
      return 'kill_mafia';
    case 'SERIAL_KILLER':
      return 'kill_serial';
    case 'FRAMER':
      return 'frame';
    case 'FORGER':
      return 'forge';
    case 'JANITOR':
      return 'clean';
    case 'BLACKMAILER':
      return 'blackmail';
    case 'DISGUISER':
      return 'disguise';
    case 'ARSONIST':
      // Default night key is the douse (the kill is the separate `ignite` toggle,
      // surfaced as its own ability-info entry below).
      return 'douse';
    case 'GODFATHER':
      return 'mafia_control';
    // JAILOR's execution uses 'kill_jailor', but only after a jailing — handled
    // by the server when the jailor presses "execute".
    case 'JAILOR':
      return 'kill_jailor';
    default:
      return null;
  }
}

/** Build the per-role ability-info list for the role card (§9.2 your_role). */
export function abilityInfoFor(seat: SeatState): AbilityInfo[] {
  const def = ROLES[seat.role];
  const out: AbilityInfo[] = [];
  switch (seat.role) {
    case 'VIGILANTE':
      out.push({ id: 'kill_vigilante', name: 'Shoot', timing: 'night', usesRemaining: seat.usesRemaining });
      break;
    case 'VETERAN':
      out.push({ id: 'alert', name: 'Alert', timing: 'night', usesRemaining: seat.usesRemaining });
      break;
    case 'JAILOR':
      out.push({ id: 'jail', name: 'Jail', timing: 'day', usesRemaining: null });
      out.push({ id: 'kill_jailor', name: 'Execute', timing: 'night', usesRemaining: seat.usesRemaining });
      break;
    case 'SURVIVOR':
      out.push({ id: 'vest', name: 'Vest', timing: 'night', usesRemaining: seat.usesRemaining });
      break;
    case 'JANITOR':
      out.push({ id: 'clean', name: 'Clean', timing: 'night', usesRemaining: seat.usesRemaining });
      break;
    case 'MEDIUM':
      // The séance is opened during the day (like jailing) and resolves at night.
      out.push({ id: 'seance', name: 'Séance', timing: 'day', usesRemaining: seat.usesRemaining });
      break;
    case 'ARSONIST':
      out.push({ id: 'douse', name: 'Douse', timing: 'night', usesRemaining: null });
      out.push({ id: 'ignite', name: 'Ignite', timing: 'night', usesRemaining: null });
      break;
    case 'WEREWOLF':
      out.push({ id: 'rampage', name: 'Rampage', timing: 'night', usesRemaining: null });
      break;
    case 'MASS_MURDERER':
      out.push({ id: 'massacre', name: 'Massacre', timing: 'night', usesRemaining: null });
      break;
    case 'GUARDIAN_ANGEL':
      out.push({ id: 'shield', name: 'Watch over', timing: 'night', usesRemaining: null });
      break;
    case 'JUGGERNAUT':
      out.push({ id: 'juggernaut', name: 'Crush', timing: 'night', usesRemaining: null });
      break;
    case 'DOCTOR':
      out.push({ id: 'protect', name: 'Heal', timing: 'night', usesRemaining: null });
      break;
    case 'BODYGUARD':
      out.push({ id: 'guard', name: 'Guard', timing: 'night', usesRemaining: null });
      break;
    case 'MAYOR':
      out.push({ id: 'reveal', name: 'Reveal', timing: 'day', usesRemaining: seat.mayorRevealed ? 0 : 1 });
      break;
    default: {
      const ab = roleToNightAbility(seat.role);
      if (ab) out.push({ id: ab, name: def.name, timing: 'night', usesRemaining: null });
    }
  }
  void VIGILANTE_BULLETS;
  void JAILOR_EXECUTIONS;
  void SURVIVOR_VESTS;
  return out;
}

/** Build the `your_role` effect for a seat (mafia roster only for mafia, §5). */
export function yourRoleEffect(state: GameState, seat: SeatState): Effect {
  const def = ROLES[seat.role];
  const abilities = abilityInfoFor(seat);
  const mates =
    seat.faction === 'MAFIA'
      ? state.seats.filter((s) => s.faction === 'MAFIA' && s.seat !== seat.seat).map((s) => s.seat)
      : undefined;
  const payload: Record<string, unknown> = {
    type: 'your_role',
    role: seat.role,
    faction: def.faction,
    abilities,
  };
  if (mates) payload.mates = mates;
  return { to: [seat.seat] as SeatId[], msg: { v: PROTOCOL_VERSION, ...payload } as never };
}
