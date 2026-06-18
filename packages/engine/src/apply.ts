/**
 * The pure `apply` step + phase machine (BUILD_SPEC §6.1–§6.3, §6.8, §6.9).
 *
 * `apply(state, event)` returns `{ state, effects }`. It clones the input,
 * routes the event by current phase, advances the state machine on `phase_end`,
 * and emits §5-addressed effects. No I/O, no clocks beyond `event.ts`.
 */

import {
  type SeatId,
  type Effect,
  type GameTick,
  type ChatChannel,
  type VerdictValue,
  DEFAULT_PHASE_SECONDS,
  DAWN_BASE_SECONDS,
  DAWN_PER_DEATH_SECONDS,
  EXECUTION_SECONDS,
  MAX_TRIALS_PER_DAY,
  MAYOR_VOTE_WEIGHT,
  JAILOR_CHAT_ALIAS,
  ROLES,
} from '@nocturne/shared';
import type { WinningParty } from '@nocturne/shared';
import type { GameState, SeatState, NightAbility, WinCheckReason } from './state.js';
import type { GameEvent } from './events.js';
import { resolveNight } from './resolve.js';
import { checkWin, checkStalemate, buildGameOver } from './wincheck.js';
import {
  cloneState,
  seatOf,
  livingSeats,
  livingMafiaSeats,
  voteWeight,
  majorityThreshold,
  toPublic,
  toDead,
  toSeat,
  toSeats,
  phaseChangeEffect,
} from './helpers.js';

/** Public API result type. */
export interface ApplyResult {
  state: GameState;
  effects: Effect[];
}

/** Phase durations in ms (from config + fixed). */
function phaseDurationMs(state: GameState, phase: string): number | null {
  const t = state.config.timings;
  const D = DEFAULT_PHASE_SECONDS;
  switch (phase) {
    case 'DAY_0':
      return (t.DAY_0 ?? D.DAY_0) * 1000;
    case 'NIGHT':
      return (t.NIGHT ?? D.NIGHT) * 1000;
    case 'DAY_DISCUSSION':
      return (t.DAY_DISCUSSION ?? D.DAY_DISCUSSION) * 1000;
    case 'DAY_VOTING':
      return (t.DAY_VOTING ?? D.DAY_VOTING) * 1000;
    case 'TRIAL_DEFENSE':
      return (t.TRIAL_DEFENSE ?? D.TRIAL_DEFENSE) * 1000;
    case 'TRIAL_JUDGMENT':
      return (t.TRIAL_JUDGMENT ?? D.TRIAL_JUDGMENT) * 1000;
    case 'EXECUTION':
      return EXECUTION_SECONDS * 1000;
    case 'DAWN':
      return null; // computed per-dawn with death count
    default:
      return null;
  }
}

export function apply(prev: GameState, event: GameEvent): ApplyResult {
  const state = cloneState(prev);
  state.lastTick = event.ts;
  const effects: Effect[] = [];

  if (state.gameOver) {
    return { state, effects };
  }

  switch (event.type) {
    case 'seat_disconnected':
      mutateSeatStatus(state, event.seat, { connected: false }, effects);
      return { state, effects };
    case 'seat_reconnected':
      mutateSeatStatus(state, event.seat, { connected: true }, effects);
      return { state, effects };
    case 'seat_afk':
      mutateSeatStatus(state, event.seat, { afk: event.afk }, effects);
      return { state, effects };
    case 'seat_left':
      handleLeave(state, event.seat, effects);
      return { state, effects };
    case 'last_will': {
      const s = seatOf(state, event.seat);
      if (s.alive) s.lastWill = event.text;
      return { state, effects };
    }
    case 'death_note': {
      const s = seatOf(state, event.seat);
      if (s.alive) s.deathNote = event.text;
      return { state, effects };
    }
    case 'chat':
      handleChat(state, event.seat, event.channel, event.text, event.ts, effects);
      return { state, effects };
    case 'whisper':
      handleWhisper(state, event.seat, event.toSeat, event.text, event.ts, effects);
      return { state, effects };
    case 'vote':
      handleVote(state, event.seat, event.target, effects);
      return { state, effects };
    case 'verdict':
      handleVerdict(state, event.seat, event.value, effects);
      return { state, effects };
    case 'night_action':
      handleNightAction(state, event.seat, event.ability, event.target);
      return { state, effects };
    case 'day_ability':
      handleDayAbility(state, event.seat, event.ability, event.target, effects);
      return { state, effects };
    case 'phase_end':
      advancePhase(state, event.ts, effects);
      return { state, effects };
    case 'admin_kill':
      handleAdminKill(state, event.seat, event.ts, effects);
      return { state, effects };
    case 'admin_stump':
      handleAdminStump(state, event.seat, event.ts, effects);
      return { state, effects };
    default:
      return { state, effects };
  }
}

// ---------------------------------------------------------------------------
// Admin god-powers (policing, goal 8) — logged & replayable; outside resolveNight
// so the deterministic night sequence is unaffected.
// ---------------------------------------------------------------------------

function handleAdminKill(state: GameState, seat: SeatId, now: GameTick, effects: Effect[]): void {
  const s = state.seats[seat];
  if (!s || !s.alive) return;
  s.alive = false;
  s.revealed = true;
  s.deathCause = 'admin';
  s.deathDay = state.dayNumber;
  state.traces.push({ step: 'death', seat, role: s.role, cause: 'admin' });
  // Detach the seat from any in-flight game machinery.
  state.mafiaSeats = state.mafiaSeats.filter((m) => m !== seat);
  state.nightIntents = state.nightIntents.filter((i) => i.seat !== seat);
  state.nomination.votes = state.nomination.votes.filter((v) => v.seat !== seat);
  if (state.trial) state.trial.verdicts = state.trial.verdicts.filter((v) => v.seat !== seat);
  if (state.jailTarget === seat) state.jailTarget = null;

  // Public reveal (legal — this IS a death reveal).
  effects.push(
    toPublic({
      type: 'death_announce',
      seat,
      role: s.role,
      ...(state.config.lastWillsEnabled && s.lastWill ? { lastWill: s.lastWill } : {}),
      cause: 'admin',
    }),
  );
  if (state.phase === 'DAY_VOTING') emitVoteUpdate(state, effects);

  // A god-kill can end the game (e.g. removing the last mafioso).
  const win = checkWin(state) ?? checkStalemate(state);
  if (win) endGame(state, win, now, effects);
}

function handleAdminStump(state: GameState, seat: SeatId, now: GameTick, effects: Effect[]): void {
  const s = state.seats[seat];
  if (!s || !s.alive || s.stumped) return;
  s.stumped = true;
  s.faction = 'TOWN'; // town-aligned for win conditions
  // Strip all agency.
  state.mafiaSeats = state.mafiaSeats.filter((m) => m !== seat);
  state.nightIntents = state.nightIntents.filter((i) => i.seat !== seat);
  state.nomination.votes = state.nomination.votes.filter((v) => v.seat !== seat);
  if (state.trial) state.trial.verdicts = state.trial.verdicts.filter((v) => v.seat !== seat);
  if (state.jailTarget === seat) state.jailTarget = null;

  // Public, leak-safe signal (being a stump is public knowledge).
  effects.push(toPublic({ type: 'seat_transform', seat, stumped: true }));
  if (state.phase === 'DAY_VOTING') emitVoteUpdate(state, effects);

  // Neutralizing an evil seat can end the game.
  const win = checkWin(state) ?? checkStalemate(state);
  if (win) endGame(state, win, now, effects);
}

// ---------------------------------------------------------------------------
// Seat status / leave
// ---------------------------------------------------------------------------

function mutateSeatStatus(
  state: GameState,
  seat: SeatId,
  patch: Partial<Pick<SeatState, 'connected' | 'afk'>>,
  effects: Effect[],
): void {
  const s = seatOf(state, seat);
  if (patch.connected !== undefined) s.connected = patch.connected;
  if (patch.afk !== undefined) s.afk = patch.afk;
  effects.push(toPublic({ type: 'seat_status', seat, connected: s.connected, afk: s.afk }));
}

function handleLeave(state: GameState, seat: SeatId, effects: Effect[]): void {
  const s = seatOf(state, seat);
  if (!s.alive) return;
  s.leaving = true;
  s.connected = false;
  effects.push(toPublic({ type: 'seat_status', seat, connected: false, afk: s.afk }));
}

// ---------------------------------------------------------------------------
// Chat (channel entitlements, §5, §6.4)
// ---------------------------------------------------------------------------

function handleChat(
  state: GameState,
  seat: SeatId,
  channel: ChatChannel,
  text: string,
  ts: GameTick,
  effects: Effect[],
): void {
  const s = seatOf(state, seat);
  switch (channel) {
    case 'day': {
      // Living seats write; everyone reads. Only during day phases.
      if (!s.alive) return;
      if (!isDayChatPhase(state.phase)) return;
      effects.push(toPublic({ type: 'chat_message', channel: 'day', from: seat, text, ts }));
      return;
    }
    case 'mafia': {
      // Living mafia only, during NIGHT.
      if (!s.alive || s.faction !== 'MAFIA' || state.phase !== 'NIGHT') return;
      const mafia = livingMafiaSeats(state).map((m) => m.seat);
      effects.push(toSeats(mafia, { type: 'chat_message', channel: 'mafia', from: seat, text, ts }));
      return;
    }
    case 'jail': {
      // Jailor (masked) + prisoner, during NIGHT, only if a jailing is in effect.
      if (state.phase !== 'NIGHT' || state.jailTarget === null) return;
      const jailor = state.seats.find((x) => x.role === 'JAILOR' && x.alive);
      if (!jailor) return;
      const prisoner = state.jailTarget;
      if (seat === jailor.seat) {
        // Jailor speaks: prisoner sees "Jailor" mask; jailor sees own message echoed.
        effects.push(
          toSeats([prisoner, jailor.seat], {
            type: 'chat_message',
            channel: 'jail',
            from: JAILOR_CHAT_ALIAS,
            text,
            ts,
          }),
        );
      } else if (seat === prisoner) {
        // Prisoner speaks: jailor sees the prisoner's seat; prisoner echoed.
        effects.push(
          toSeats([prisoner, jailor.seat], {
            type: 'chat_message',
            channel: 'jail',
            from: seat,
            text,
            ts,
          }),
        );
      }
      return;
    }
    case 'dead': {
      // Dead seats only, any time after death.
      if (s.alive) return;
      effects.push(toDead({ type: 'chat_message', channel: 'dead', from: seat, text, ts }));
      return;
    }
    case 'lobby':
    case 'whisper':
    default:
      return;
  }
}

function handleWhisper(
  state: GameState,
  seat: SeatId,
  toSeatId: SeatId,
  text: string,
  ts: GameTick,
  effects: Effect[],
): void {
  if (!state.config.whispersEnabled) return;
  const s = seatOf(state, seat);
  const t = seatOf(state, toSeatId);
  if (!s.alive || !t.alive) return;
  if (!isDayChatPhase(state.phase)) return;
  // Public metadata.
  effects.push(toPublic({ type: 'whisper_meta', fromSeat: seat, toSeat: toSeatId }));
  // Private delivery (recipient + sender echo).
  effects.push(toSeats([toSeatId, seat], { type: 'whisper', fromSeat: seat, text }));
  void ts;
}

function isDayChatPhase(phase: string): boolean {
  return (
    phase === 'DAY_0' ||
    phase === 'DAY_DISCUSSION' ||
    phase === 'DAY_VOTING' ||
    phase === 'TRIAL_DEFENSE' ||
    phase === 'TRIAL_JUDGMENT' ||
    phase === 'EXECUTION'
  );
}

// ---------------------------------------------------------------------------
// Voting (nomination) — DAY_VOTING
// ---------------------------------------------------------------------------

function handleVote(
  state: GameState,
  seat: SeatId,
  target: SeatId | 'skip' | null,
  effects: Effect[],
): void {
  if (state.phase !== 'DAY_VOTING') return;
  const s = seatOf(state, seat);
  if (!s.alive || s.stumped) return; // a stump cannot vote (goal 8)

  // Update/retract vote.
  state.nomination.votes = state.nomination.votes.filter((v) => v.seat !== seat);
  if (target !== null) {
    if (target !== 'skip' && (!state.seats[target] || !state.seats[target]!.alive)) return;
    state.nomination.votes.push({ seat, target });
  }
  state.nomination.votes.sort((a, b) => a.seat - b.seat);

  emitVoteUpdate(state, effects);

  // Check thresholds.
  const threshold = majorityThreshold(state);
  const tallies = computeTallies(state);

  // Skip majority ends the day.
  const skipWeight = state.nomination.votes
    .filter((v) => v.target === 'skip')
    .reduce((sum, v) => sum + voteWeight(seatOf(state, v.seat)), 0);
  if (skipWeight >= threshold) {
    endDayNoLynch(state, effects);
    return;
  }

  // Nomination majority → trial.
  for (const [accused, weight] of tallies) {
    if (weight >= threshold) {
      startTrial(state, accused, effects);
      return;
    }
  }
}

function computeTallies(state: GameState): Map<SeatId, number> {
  const m = new Map<SeatId, number>();
  for (const v of state.nomination.votes) {
    if (v.target === 'skip') continue;
    const w = voteWeight(seatOf(state, v.seat));
    m.set(v.target, (m.get(v.target) ?? 0) + w);
  }
  return m;
}

function emitVoteUpdate(state: GameState, effects: Effect[]): void {
  const tallies = [...computeTallies(state).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seat, weight]) => ({ seat, weight }));
  const votesBySeat = state.nomination.votes.map((v) => ({ seat: v.seat, target: v.target }));
  effects.push(toPublic({ type: 'vote_update', tallies, votesBySeat }));
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

function startTrial(state: GameState, accused: SeatId, effects: Effect[]): void {
  // Pause the DAY_VOTING timer.
  if (state.phaseEndsAt !== null) {
    state.nomination.pausedRemainingMs = Math.max(0, state.phaseEndsAt - state.lastTick);
  }
  state.trial = { accused, verdicts: [] };
  // Clear nomination votes for the new trial sequence.
  state.nomination.votes = [];
  enterPhase(state, 'TRIAL_DEFENSE', state.lastTick, effects);
  effects.push(toPublic({ type: 'trial_start', accusedSeat: accused }));
}

function handleVerdict(
  state: GameState,
  seat: SeatId,
  value: VerdictValue,
  effects: Effect[],
): void {
  if (state.phase !== 'TRIAL_JUDGMENT' || !state.trial) return;
  const s = seatOf(state, seat);
  if (!s.alive || seat === state.trial.accused) return;
  state.trial.verdicts = state.trial.verdicts.filter((v) => v.seat !== seat);
  state.trial.verdicts.push({ seat, value });
  state.trial.verdicts.sort((a, b) => a.seat - b.seat);
  // Verdicts are private while voting — no public emission here.
  void effects;
}

/** Tally a trial: returns 'guilty' or 'innocent'. */
function tallyTrial(state: GameState): 'guilty' | 'innocent' {
  if (!state.trial) return 'innocent';
  let guilty = 0;
  let innocent = 0;
  for (const v of state.trial.verdicts) {
    const w = voteWeight(seatOf(state, v.seat));
    if (v.value === 'guilty') guilty += w;
    else if (v.value === 'innocent') innocent += w;
  }
  return guilty > innocent ? 'guilty' : 'innocent';
}

// ---------------------------------------------------------------------------
// Night actions
// ---------------------------------------------------------------------------

function handleNightAction(
  state: GameState,
  seat: SeatId,
  ability: NightAbility,
  target: SeatId | null,
): void {
  if (state.phase !== 'NIGHT') return;
  const s = seatOf(state, seat);
  if (!s.alive || s.stumped) return; // a stump has no night action (goal 8)

  // Remove any prior intent for this seat (last submission wins).
  state.nightIntents = state.nightIntents.filter((i) => i.seat !== seat);
  if (target === null && ability !== 'vest') {
    return; // cancel
  }
  state.nightIntents.push({ seat, ability, target });
  state.nightIntents.sort((a, b) => a.seat - b.seat);
}

// ---------------------------------------------------------------------------
// Day abilities (jailor select, mayor reveal)
// ---------------------------------------------------------------------------

function handleDayAbility(
  state: GameState,
  seat: SeatId,
  ability: 'jail' | 'reveal',
  target: SeatId | undefined,
  effects: Effect[],
): void {
  const s = seatOf(state, seat);
  if (!s.alive || s.stumped) return; // a stump has no day ability (goal 8)

  if (ability === 'jail') {
    // Jailor selects a prisoner during day phases (not Day 0).
    if (s.role !== 'JAILOR') return;
    if (state.phase === 'DAY_0') return; // can't jail on Day 0
    if (!isDayPhase(state.phase)) return;
    if (target === undefined || !state.seats[target] || !state.seats[target]!.alive) return;
    if (target === seat) return; // can't jail self
    state.jailTarget = target;
    effects.push(toSeat(seat, { type: 'day_ability_ack', ability: 'jail', target }));
  } else if (ability === 'reveal') {
    if (s.role !== 'MAYOR' || s.mayorRevealed) return;
    if (!isDayPhase(state.phase)) return;
    s.mayorRevealed = true;
    s.revealed = true; // role becomes public knowledge
    effects.push(
      toPublic({
        type: 'day_ability_ack',
        ability: 'reveal',
        target: seat,
      }),
    );
    // Re-emit tallies with new weight if mid-vote.
    if (state.phase === 'DAY_VOTING') emitVoteUpdate(state, effects);
    void MAYOR_VOTE_WEIGHT;
  }
}

function isDayPhase(phase: string): boolean {
  return (
    phase === 'DAY_0' ||
    phase === 'DAY_DISCUSSION' ||
    phase === 'DAY_VOTING' ||
    phase === 'TRIAL_DEFENSE' ||
    phase === 'TRIAL_JUDGMENT' ||
    phase === 'EXECUTION'
  );
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

/** Enter a phase: set phase, compute deadline, emit phase_change. */
function enterPhase(state: GameState, phase: GameState['phase'], now: GameTick, effects: Effect[]): void {
  state.phase = phase;
  const dur = phaseDurationMs(state, phase);
  state.phaseEndsAt = dur === null ? null : now + dur;
  effects.push(phaseChangeEffect(phase, state.dayNumber, state.phaseEndsAt));
}

/** Advance the phase machine on a phase_end event. */
function advancePhase(state: GameState, now: GameTick, effects: Effect[]): void {
  switch (state.phase) {
    case 'ASSIGN':
      startDay0(state, now, effects);
      return;
    case 'DAY_0':
      enterNight(state, now, effects);
      return;
    case 'NIGHT':
      runNightResolution(state, now, effects);
      return;
    case 'DAWN':
      enterPhase(state, 'DAY_DISCUSSION', now, effects);
      return;
    case 'DAY_DISCUSSION':
      startDayVoting(state, now, effects);
      return;
    case 'DAY_VOTING':
      endDayNoLynch(state, effects, now);
      return;
    case 'TRIAL_DEFENSE':
      enterPhase(state, 'TRIAL_JUDGMENT', now, effects);
      return;
    case 'TRIAL_JUDGMENT':
      concludeTrial(state, now, effects);
      return;
    case 'EXECUTION':
      afterExecution(state, now, effects);
      return;
    default:
      return;
  }
}

function startDay0(state: GameState, now: GameTick, effects: Effect[]): void {
  state.dayNumber = 0;
  enterPhase(state, 'DAY_0', now, effects);
}

function enterNight(state: GameState, now: GameTick, effects: Effect[]): void {
  state.nightNumber += 1;
  state.nightIntents = [];
  // jailTarget carries from the day's jailor selection; keep it.
  enterPhase(state, 'NIGHT', now, effects);
}

function runNightResolution(state: GameState, now: GameTick, effects: Effect[]): void {
  const before = livingSeats(state).length;
  const res = resolveNight(state);
  effects.push(...res.effects);
  state.traces.push(...res.traces);

  // Clear night inputs.
  state.nightIntents = [];
  state.jailTarget = null;

  // Quiet-night tracking for stalemate guard.
  if (res.deaths.length === 0) state.quietNights += 1;
  else state.quietNights = 0;

  // Win check at end of NIGHT resolution (before DAWN announcements).
  const stalemate = checkStalemate(state);
  const win = checkWin(state) ?? stalemate;
  if (win) {
    endGame(state, win, now, effects);
    return;
  }

  // Compose DAWN: paced reveals. Death announcements are public.
  for (const d of res.deaths) {
    const s = seatOf(state, d.seat);
    const killer = killerOf(state, d.seat, res);
    effects.push(
      toPublic({
        type: 'death_announce',
        seat: d.seat,
        role: s.role,
        ...(state.config.lastWillsEnabled && s.lastWill ? { lastWill: s.lastWill } : {}),
        ...(killer && killer.deathNote ? { deathNote: killer.deathNote } : {}),
        cause: d.cause,
      }),
    );
  }

  const dawnMs = (DAWN_BASE_SECONDS + DAWN_PER_DEATH_SECONDS * res.deaths.length) * 1000;
  state.phase = 'DAWN';
  state.phaseEndsAt = now + dawnMs;
  effects.push(phaseChangeEffect('DAWN', state.dayNumber, state.phaseEndsAt));
  void before;
}

/** Find the killer's seat (for death-note attribution). */
function killerOf(
  state: GameState,
  victim: SeatId,
  res: { traces: GameState['traces'] },
): SeatState | null {
  // Look at the death trace's matching kill trace with outcome 'died'.
  for (const t of res.traces) {
    if (t.step === 'kill' && t.target === victim && t.outcome === 'died' && t.attacker !== null) {
      if (t.source === 'mafia' || t.source === 'serial_killer') {
        return seatOf(state, t.attacker);
      }
    }
  }
  return null;
}

function startDayVoting(state: GameState, now: GameTick, effects: Effect[]): void {
  state.dayNumber += 1;
  state.nomination = { votes: [], trialsUsed: 0, pausedRemainingMs: null };

  // Win check at start of DAY_VOTING (parity / 1v1 auto-resolve).
  const win = checkWin(state, { atDayVotingStart: true });
  if (win) {
    endGame(state, win, now, effects);
    return;
  }
  enterPhase(state, 'DAY_VOTING', now, effects);
}

function startTrialDefenseResume(state: GameState, now: GameTick, effects: Effect[]): void {
  // Resume DAY_VOTING with the paused remaining time.
  const remaining = state.nomination.pausedRemainingMs ?? phaseDurationMs(state, 'DAY_VOTING')!;
  state.nomination.pausedRemainingMs = null;
  state.trial = null;
  state.nomination.votes = [];
  state.phase = 'DAY_VOTING';
  state.phaseEndsAt = now + remaining;
  effects.push(phaseChangeEffect('DAY_VOTING', state.dayNumber, state.phaseEndsAt));
}

function concludeTrial(state: GameState, now: GameTick, effects: Effect[]): void {
  if (!state.trial) {
    startTrialDefenseResume(state, now, effects);
    return;
  }
  const outcome = tallyTrial(state);
  const accused = state.trial.accused;
  // Reveal each voter's verdict publicly.
  effects.push(
    toPublic({
      type: 'verdict_result',
      accusedSeat: accused,
      outcome,
      votes: state.trial.verdicts.map((v) => ({ seat: v.seat, value: v.value })),
    }),
  );
  state.nomination.trialsUsed += 1;

  if (outcome === 'guilty') {
    enterPhase(state, 'EXECUTION', now, effects);
    return;
  }

  // Innocent: if trials exhausted, day ends; else resume DAY_VOTING.
  if (state.nomination.trialsUsed >= MAX_TRIALS_PER_DAY) {
    endDayNoLynch(state, effects, now);
    return;
  }
  startTrialDefenseResume(state, now, effects);
}

function afterExecution(state: GameState, now: GameTick, effects: Effect[]): void {
  if (!state.trial) {
    enterNight(state, now, effects);
    return;
  }
  const accused = seatOf(state, state.trial.accused);
  // Execute.
  accused.alive = false;
  accused.revealed = true;
  accused.deathCause = 'lynch';
  accused.deathDay = state.dayNumber;
  state.traces.push({ step: 'death', seat: accused.seat, role: accused.role, cause: 'lynch' });

  // Jester personal win + schedule grief.
  if (accused.role === 'JESTER') {
    state.jesterWinners.push(accused.seat);
    const guiltyVoters = state.trial.verdicts
      .filter((v) => v.value === 'guilty')
      .map((v) => v.seat);
    if (guiltyVoters.length > 0) {
      state.pendingJesterGrief = { guiltyVoters };
    }
  }
  // Executioner personal win if their target was lynched while exe lives.
  for (const s of state.seats) {
    if (s.role === 'EXECUTIONER' && s.alive && s.exeTarget === accused.seat) {
      state.exeWinners.push(s.seat);
    }
  }

  // Public reveal of the executed seat (role + last will).
  effects.push(
    toPublic({
      type: 'death_announce',
      seat: accused.seat,
      role: accused.role,
      ...(state.config.lastWillsEnabled && accused.lastWill ? { lastWill: accused.lastWill } : {}),
      cause: 'lynch',
    }),
  );

  state.trial = null;

  // Win check after EXECUTION.
  const win = checkWin(state);
  if (win) {
    endGame(state, win, now, effects);
    return;
  }
  enterNight(state, now, effects);
}

/** End the day with no lynch: refresh nomination state, go to night. */
function endDayNoLynch(state: GameState, effects: Effect[], now?: GameTick): void {
  const t = now ?? state.lastTick;
  state.nomination = { votes: [], trialsUsed: 0, pausedRemainingMs: null };
  state.trial = null;
  enterNight(state, t, effects);
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

function endGame(
  state: GameState,
  win: { reason: WinCheckReason; winners: WinningParty[] },
  now: GameTick,
  effects: Effect[],
): void {
  const over = buildGameOver(state, win);
  state.gameOver = over;
  state.traces.push({ step: 'win', reason: over.reason, winners: over.winners });
  // Reveal everyone.
  for (const s of state.seats) s.revealed = true;
  state.phase = 'GAME_OVER';
  state.phaseEndsAt = null;
  effects.push(phaseChangeEffect('GAME_OVER', state.dayNumber, null));
  effects.push(
    toPublic({
      type: 'game_over',
      winners: over.winners,
      allRoles: over.results.map((r) => ({
        seat: r.seat,
        role: r.role,
        faction: r.faction,
        outcome: r.outcome,
      })),
      seed: state.seed,
      matchId: state.matchId,
    }),
  );
  void now;
  void ROLES;
}
