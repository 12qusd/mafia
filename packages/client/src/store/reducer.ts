/**
 * Pure server-message reducer (BUILD_SPEC §13, §9.2). Given the current store
 * state and a *validated* server message, returns the next state. No I/O, no
 * side effects — this is the unit-tested core (§13.2 tests: phase_change,
 * vote_update, death handling).
 *
 * Resilience rules (§13 resilience):
 *  - messages may arrive in any order; each handler is defensive;
 *  - unknown message types never reach here (filtered in the WS layer), but the
 *    `default` branch returns state unchanged as a final safety net.
 */

import {
  type ServerMessage,
  type SeatSnapshot,
  type ChatRecord,
  type Phase,
  PrivateResultPayloadSchema,
  type PrivateResultPayload,
} from '@nocturne/shared';
import { sanitizeText, sanitizeInline } from '../lib/sanitize.js';
import type {
  StoreState,
  GameView,
  OwnState,
  ChatLine,
  PrivateResultLine,
} from './types.js';
import { DEBUG_EVENT_CAP } from './types.js';

/** Monotonic id source for client-side list keys. */
let nextId = 1;
export function allocId(): number {
  return nextId++;
}

/** Reset the id counter (test helper). */
export function __resetIds(): void {
  nextId = 1;
}

function emptyGame(setupId: string): GameView {
  return {
    setupId,
    seats: [],
    phase: 'ASSIGN',
    dayNumber: 0,
    endsAt: null,
    tallies: [],
    votesBySeat: [],
    accusedSeat: null,
    lastVerdict: null,
    deathFeed: [],
    spectator: false,
    stumpedSeats: [],
  };
}

/** A fresh (empty) god-view container. */
export function emptyDebug(): StoreState['debug'] {
  return { state: null, traces: [], events: [] };
}

function emptyOwn(seat: number): OwnState {
  return {
    seat,
    role: 'CITIZEN',
    faction: 'TOWN',
    abilities: [],
    assignedTarget: null,
    nightTarget: null,
    nightTarget2: null,
    nightAbility: null,
    jailTarget: null,
    revealed: false,
    lastWill: '',
    deathNote: '',
    vote: null,
    verdict: null,
  };
}

/** Sanitize a chat record into a renderable line. */
function toChatLine(rec: { channel: ChatRecord['channel']; from: number | 'Jailor'; text: string; ts: number }): ChatLine {
  return {
    id: allocId(),
    channel: rec.channel,
    from: rec.from,
    text: sanitizeText(rec.text),
    ts: rec.ts,
  };
}

/** Build full game/own/chat state from a resume snapshot (§8). */
function applySnapshot(state: StoreState, snap: SeatSnapshot): Partial<StoreState> {
  const seats = snap.seats.map((s) => ({ ...s, name: sanitizeInline(s.name) }));
  const game: GameView = {
    setupId: state.game?.setupId ?? '',
    seats,
    phase: snap.phase,
    dayNumber: snap.dayNumber,
    endsAt: snap.endsAt,
    tallies: [],
    votesBySeat: [],
    accusedSeat: null,
    lastVerdict: null,
    deathFeed: [],
    spectator: false,
    stumpedSeats: [],
  };
  const own: OwnState = {
    ...emptyOwn(snap.seat),
    role: snap.ownRole,
    faction: snap.ownFaction,
    abilities: snap.abilities,
    ...(snap.mates ? { mates: snap.mates } : {}),
    lastWill: snap.lastWill ?? '',
    deathNote: snap.deathNote ?? '',
  };
  const chat: ChatLine[] = snap.chatBacklog.map(toChatLine);

  // Private log: opaque records; keep only ones that parse as a known payload.
  const privateLog: PrivateResultLine[] = [];
  for (const raw of snap.privateLog) {
    const parsed = PrivateResultPayloadSchema.safeParse(raw);
    if (parsed.success) {
      privateLog.push({ id: allocId(), payload: parsed.data, dayNumber: snap.dayNumber });
    }
  }
  return { game, own, chat, privateLog };
}

/**
 * Apply one validated server message. Returns a partial state patch (merged by
 * the caller). Pure.
 */
export function reduce(state: StoreState, msg: ServerMessage): Partial<StoreState> {
  switch (msg.type) {
    case 'welcome': {
      const patch: Partial<StoreState> = {
        connection: 'open',
        userId: msg.userId ?? null,
        guestId: msg.guestId ?? null,
      };
      if (msg.resume) {
        Object.assign(patch, applySnapshot(state, msg.resume));
      }
      return patch;
    }

    case 'lobby_state': {
      const lobby = {
        ...msg.lobby,
        name: sanitizeInline(msg.lobby.name),
        members: msg.lobby.members.map((m) => ({ ...m, name: sanitizeInline(m.name) })),
      };
      return { lobby };
    }

    case 'game_started': {
      const game: GameView = {
        ...emptyGame(msg.setupId),
        seats: msg.seats.map((s) => ({ ...s, name: sanitizeInline(s.name) })),
        phase: 'ASSIGN',
        dayNumber: 0,
      };
      return {
        game,
        gameOver: null,
        pointsAward: null,
        chat: [],
        whisperMeta: [],
        privateLog: [],
        jailedThisNight: false,
        silencedToday: false,
        debug: emptyDebug(),
      };
    }

    case 'your_role': {
      // `your_role` is also RE-EMITTED mid-game on a role MUTATION (e.g. a
      // Guardian Angel whose charge dies becomes a Survivor, a Mafioso promoted
      // to Godfather, an Amnesiac who remembers). We must fully replace the
      // role/faction/abilities and the bound `assignedTarget` from the resent
      // frame, and drop stale pending night selections that referenced the OLD
      // ability set (the new card may have entirely different abilities).
      const prev = state.own ?? emptyOwn(0);
      const roleChanged = prev.role !== msg.role;
      // Strip the OLD roster: a mutated role may no longer be in an informed
      // faction, so a resend without `mates` must DROP the previous mates.
      const { mates: _drop, ...base } = prev;
      void _drop;
      const own: OwnState = {
        ...base,
        role: msg.role,
        faction: msg.faction,
        abilities: msg.abilities,
        assignedTarget: msg.assignedTarget ?? null,
        ...(msg.mates ? { mates: msg.mates } : {}),
        ...(roleChanged
          ? { nightAbility: null, nightTarget: null, nightTarget2: null }
          : {}),
      };
      return { own };
    }

    case 'phase_change': {
      if (!state.game) return {};
      // Phase transitions clear per-phase ephemeral selections.
      const own = state.own ? clearPhaseSelections(state.own, msg.phase) : state.own;
      const game: GameView = {
        ...state.game,
        phase: msg.phase,
        dayNumber: msg.dayNumber,
        endsAt: msg.endsAt,
        // A fresh DAY_VOTING resets tallies; entering NIGHT clears trial state.
        tallies: msg.phase === 'DAY_VOTING' ? state.game.tallies : [],
        votesBySeat: msg.phase === 'DAY_VOTING' ? state.game.votesBySeat : [],
        accusedSeat:
          msg.phase === 'TRIAL_DEFENSE' || msg.phase === 'TRIAL_JUDGMENT' || msg.phase === 'EXECUTION'
            ? state.game.accusedSeat
            : null,
      };
      const patch: Partial<StoreState> = own ? { game, own } : { game };
      // Chat-context flags (§6.4): the prisoner tab is NIGHT-scoped, so it clears
      // the moment we leave NIGHT. The blackmail silence is applied at night for
      // the FOLLOWING day, so it clears when a new NIGHT begins.
      if (msg.phase !== 'NIGHT') {
        patch.jailedThisNight = false;
      } else {
        patch.silencedToday = false;
      }
      return patch;
    }

    case 'chat_message': {
      const line = toChatLine({ channel: msg.channel, from: msg.from, text: msg.text, ts: msg.ts });
      return { chat: [...state.chat, line] };
    }

    case 'whisper': {
      // Whisper to this recipient — surfaced in the Whispers channel.
      const line: ChatLine = {
        id: allocId(),
        channel: 'whisper',
        from: msg.fromSeat,
        text: sanitizeText(msg.text),
        ts: Date.now(),
      };
      return { chat: [...state.chat, line] };
    }

    case 'whisper_meta': {
      return {
        whisperMeta: [
          ...state.whisperMeta,
          { id: allocId(), fromSeat: msg.fromSeat, toSeat: msg.toSeat, ts: Date.now() },
        ],
      };
    }

    case 'vote_update': {
      if (!state.game) return {};
      return {
        game: { ...state.game, tallies: msg.tallies, votesBySeat: msg.votesBySeat },
      };
    }

    case 'trial_start': {
      if (!state.game) return {};
      const own = state.own ? { ...state.own, verdict: null } : state.own;
      const game = { ...state.game, accusedSeat: msg.accusedSeat, lastVerdict: null };
      return own ? { game, own } : { game };
    }

    case 'verdict_result': {
      if (!state.game) return {};
      return { game: { ...state.game, lastVerdict: msg } };
    }

    case 'death_announce': {
      if (!state.game) return {};
      // Mark the seat dead + revealed in the public list, and queue the feed item.
      const seats = state.game.seats.map((s) =>
        s.seat === msg.seat
          ? { ...s, alive: false, role: msg.role }
          : s,
      );
      return {
        game: {
          ...state.game,
          seats,
          deathFeed: [...state.game.deathFeed, msg],
        },
      };
    }

    case 'private_result': {
      // The message is envelope ∧ payload; extract the payload fields.
      const payload = extractPrivatePayload(msg);
      if (!payload) return {};
      const entry: PrivateResultLine = {
        id: allocId(),
        payload,
        dayNumber: state.game?.dayNumber ?? 0,
      };
      const patch: Partial<StoreState> = {
        privateLog: [...state.privateLog, entry],
      };
      // Chat-context flags (§6.4): a `jailed` result means THIS seat is tonight's
      // prisoner (jail tab); a `blackmailed` result silences this seat in the
      // following day chat (day-chat input disabled). Both are cleared by the
      // phase machine (jailed on leaving NIGHT, silenced on entering NIGHT).
      if (payload.kind === 'jailed') patch.jailedThisNight = true;
      if (payload.kind === 'blackmailed') patch.silencedToday = true;
      return patch;
    }

    case 'day_ability_ack': {
      if (!state.own) return {};
      // Acknowledge jailor jail-select / mayor reveal.
      if (msg.ability === 'jail') {
        return { own: { ...state.own, jailTarget: msg.target ?? null } };
      }
      if (msg.ability === 'reveal') {
        return { own: { ...state.own, revealed: true } };
      }
      return {};
    }

    case 'game_over': {
      return {
        gameOver: {
          winners: msg.winners,
          allRoles: msg.allRoles,
          seed: msg.seed,
          matchId: msg.matchId,
        },
        game: state.game
          ? { ...state.game, phase: 'GAME_OVER', endsAt: null, deathFeed: [] }
          : state.game,
      };
    }

    case 'seat_status': {
      if (!state.game) return {};
      const seats = state.game.seats.map((s) =>
        s.seat === msg.seat ? { ...s, connected: msg.connected, afk: msg.afk } : s,
      );
      return { game: { ...state.game, seats } };
    }

    case 'points_awarded': {
      // Per-player post-match award (goal 3). Stored for the GameOver
      // celebration. The summary is the wire-typed `UserStatsSummary`; if this
      // is the local registered account, refresh the cached `me.stats` too so
      // the home profile card updates without a round-trip.
      const patch: Partial<StoreState> = {
        pointsAward: {
          matchId: msg.matchId,
          breakdown: msg.breakdown,
          stats: msg.stats,
          newAchievements: msg.newAchievements,
        },
      };
      if (state.me && state.me.id === msg.stats.userId) {
        patch.me = { ...state.me, stats: msg.stats };
      }
      return patch;
    }

    case 'seat_transform': {
      // Public stump marker (goal 8). Track in the parallel set; never mutate
      // the server-sent PublicSeat shape.
      if (!state.game) return {};
      const cur = state.game.stumpedSeats;
      const next = msg.stumped
        ? cur.includes(msg.seat)
          ? cur
          : [...cur, msg.seat]
        : cur.filter((s) => s !== msg.seat);
      return { game: { ...state.game, stumpedSeats: next } };
    }

    case 'error': {
      return {
        toasts: [...state.toasts, { id: allocId(), code: msg.code, ...(msg.detail ? { detail: msg.detail } : {}) }],
      };
    }

    case 'pong': {
      // Clock estimate is folded in by the WS layer (it knows the send time).
      return {};
    }

    // --- TEST MODE god-view frames (god audience only, §debug.ts) ---------
    // These reach the reducer only for the host of a gated test lobby; a normal
    // client never receives them. They are validated by the shared zod schemas
    // in the WS layer before arriving here.
    case 'debug_state': {
      return { debug: { ...state.debug, state: msg } };
    }

    case 'debug_trace': {
      // Append per-night traces; the viewer renders newest-first. De-dupe by
      // night so a resend (request_state) does not double a night's trace.
      const without = state.debug.traces.filter((t) => t.nightNumber !== msg.nightNumber);
      return { debug: { ...state.debug, traces: [...without, msg] } };
    }

    case 'debug_event': {
      // Action-log mirror; ring-buffer to the most recent DEBUG_EVENT_CAP rows.
      const events = [...state.debug.events, msg];
      if (events.length > DEBUG_EVENT_CAP) events.splice(0, events.length - DEBUG_EVENT_CAP);
      return { debug: { ...state.debug, events } };
    }

    case 'force_update': {
      return { connection: 'force_update', forceUpdateMin: msg.minProtocolVersion };
    }

    default: {
      // Unknown/unhandled type — leave state untouched (resilience, §13).
      return {};
    }
  }
}

/** Clear per-phase selections that should not survive a transition. */
function clearPhaseSelections(own: OwnState, phase: Phase): OwnState {
  // Entering NIGHT clears the previous night's action; entering a non-voting
  // phase clears the vote; entering a non-judgment phase clears the verdict.
  let next = own;
  if (phase === 'NIGHT') {
    next = { ...next, nightTarget: null, nightTarget2: null, nightAbility: null };
  }
  if (phase !== 'DAY_VOTING') {
    next = { ...next, vote: null };
  }
  if (phase !== 'TRIAL_JUDGMENT') {
    next = { ...next, verdict: null };
  }
  return next;
}

/** Pull the discriminated payload out of a `private_result` message. */
function extractPrivatePayload(msg: Extract<ServerMessage, { type: 'private_result' }>): PrivateResultPayload | null {
  const parsed = PrivateResultPayloadSchema.safeParse(msg);
  return parsed.success ? parsed.data : null;
}
