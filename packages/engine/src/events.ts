/**
 * Engine input events (BUILD_SPEC §6, §9.1).
 *
 * A {@link GameEvent} is either a *validated* player command (the server has
 * already checked seat-alive / phase / role / target / rate-limit per §5.5) or a
 * server-scheduled event (phase deadline, connection changes, leave). The engine
 * re-validates game-rule legality but trusts the envelope shape.
 *
 * Every event carries `ts` (server epoch ms): the engine's only clock. Phase
 * deadlines are computed from `ts` + config durations — the engine never reads a
 * wall clock (§4.3).
 */

import type { SeatId, GameTick, ChatChannel, VerdictValue } from '@nocturne/shared';
import type { NightAbility } from './state.js';

interface Stamped {
  /** Server epoch ms when this event was accepted. The engine's logical clock. */
  ts: GameTick;
}

/** Open nomination vote (DAY_VOTING). `target` null retracts. */
export interface VoteEvent extends Stamped {
  type: 'vote';
  seat: SeatId;
  target: SeatId | 'skip' | null;
}

/** Trial judgment vote (TRIAL_JUDGMENT). */
export interface VerdictEvent extends Stamped {
  type: 'verdict';
  seat: SeatId;
  value: VerdictValue;
}

/** Night ability submission (NIGHT). `target` null cancels. */
export interface NightActionEvent extends Stamped {
  type: 'night_action';
  seat: SeatId;
  ability: NightAbility;
  target: SeatId | null;
}

/** Day ability (jailor select / mayor reveal). */
export interface DayAbilityEvent extends Stamped {
  type: 'day_ability';
  seat: SeatId;
  ability: 'jail' | 'reveal';
  target?: SeatId;
}

/** Chat in a channel. */
export interface ChatEvent extends Stamped {
  type: 'chat';
  seat: SeatId;
  channel: ChatChannel;
  text: string;
}

/** Whisper to a recipient (day phases). */
export interface WhisperEvent extends Stamped {
  type: 'whisper';
  seat: SeatId;
  toSeat: SeatId;
  text: string;
}

/** Edit last will. */
export interface LastWillEvent extends Stamped {
  type: 'last_will';
  seat: SeatId;
  text: string;
}

/** Edit death note. */
export interface DeathNoteEvent extends Stamped {
  type: 'death_note';
  seat: SeatId;
  text: string;
}

/** Server-scheduled phase deadline reached (advance the machine). */
export interface PhaseEndEvent extends Stamped {
  type: 'phase_end';
}

/** Connection state changes (public indicators; never pause the game). */
export interface SeatDisconnectedEvent extends Stamped {
  type: 'seat_disconnected';
  seat: SeatId;
}
export interface SeatReconnectedEvent extends Stamped {
  type: 'seat_reconnected';
  seat: SeatId;
}

/** Explicit "leave game": seat suicides at the next night resolution (§8). */
export interface SeatLeftEvent extends Stamped {
  type: 'seat_left';
  seat: SeatId;
}

/** AFK flag toggle (server-driven; public indicator). */
export interface SeatAfkEvent extends Stamped {
  type: 'seat_afk';
  seat: SeatId;
  afk: boolean;
}

export type GameEvent =
  | VoteEvent
  | VerdictEvent
  | NightActionEvent
  | DayAbilityEvent
  | ChatEvent
  | WhisperEvent
  | LastWillEvent
  | DeathNoteEvent
  | PhaseEndEvent
  | SeatDisconnectedEvent
  | SeatReconnectedEvent
  | SeatLeftEvent
  | SeatAfkEvent;
