import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  type ServerMessage,
  type PublicSeat,
} from '@nocturne/shared';
import { reduce, __resetIds } from '../store/reducer.js';
import { INITIAL_CLOCK_ESTIMATE } from '../lib/clock.js';
import type { StoreState } from '../store/types.js';

function baseState(): StoreState {
  return {
    connection: 'open',
    clock: INITIAL_CLOCK_ESTIMATE,
    forceUpdateMin: null,
    userId: null,
    guestId: null,
    lobby: null,
    game: null,
    own: null,
    gameOver: null,
    chat: [],
    whisperMeta: [],
    privateLog: [],
    toasts: [],
    debug: { state: null, traces: [], events: [] },
  };
}

function seat(n: number, alive = true, name = `P${n}`): PublicSeat {
  return { seat: n, name, alive, connected: true, afk: false };
}

/** Apply a message, asserting it is a valid server message first. */
function apply(state: StoreState, msg: ServerMessage): StoreState {
  // Round-trip validation: every message a reducer handles must be a valid
  // server frame (defence-in-depth, mirrors the WS layer).
  const parsed = ServerMessageSchema.parse(msg);
  return { ...state, ...reduce(state, parsed as ServerMessage) };
}

beforeEach(() => __resetIds());

describe('reduce: game lifecycle', () => {
  it('game_started seeds the public seat list and clears logs', () => {
    let s = baseState();
    s.chat = [{ id: 1, channel: 'lobby', from: 0, text: 'old', ts: 0 }];
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'game_started',
      seats: [seat(0), seat(1)],
      setupId: 'classic-nocturne',
      config: {},
    });
    expect(s.game?.seats).toHaveLength(2);
    expect(s.game?.setupId).toBe('classic-nocturne');
    expect(s.chat).toHaveLength(0);
  });

  it('your_role stores own secret state', () => {
    let s = baseState();
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'your_role',
      role: 'SHERIFF',
      faction: 'TOWN',
      abilities: [{ id: 'investigate', name: 'Investigate', timing: 'night', usesRemaining: null }],
    });
    expect(s.own?.role).toBe('SHERIFF');
    expect(s.own?.faction).toBe('TOWN');
    expect(s.own?.abilities[0]?.id).toBe('investigate');
  });
});

describe('reduce: phase_change (BUILD_SPEC §6.1, §6.2)', () => {
  function withGame(): StoreState {
    let s = baseState();
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'game_started',
      seats: [seat(0), seat(1), seat(2)],
      setupId: 'classic-nocturne',
      config: {},
    });
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'your_role',
      role: 'DOCTOR',
      faction: 'TOWN',
      abilities: [{ id: 'protect', name: 'Protect', timing: 'night', usesRemaining: null }],
    });
    return s;
  }

  it('updates phase / day / deadline', () => {
    let s = withGame();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'phase_change', phase: 'NIGHT', dayNumber: 1, endsAt: 12345 });
    expect(s.game?.phase).toBe('NIGHT');
    expect(s.game?.dayNumber).toBe(1);
    expect(s.game?.endsAt).toBe(12345);
  });

  it('clears the night action when entering NIGHT', () => {
    let s = withGame();
    s.own = { ...s.own!, nightTarget: 2, nightAbility: 'protect' };
    s = apply(s, { v: PROTOCOL_VERSION, type: 'phase_change', phase: 'NIGHT', dayNumber: 1, endsAt: null });
    expect(s.own?.nightTarget).toBeNull();
    expect(s.own?.nightAbility).toBeNull();
  });

  it('clears the vote when leaving DAY_VOTING', () => {
    let s = withGame();
    s.own = { ...s.own!, vote: 1 };
    s = apply(s, { v: PROTOCOL_VERSION, type: 'phase_change', phase: 'NIGHT', dayNumber: 1, endsAt: null });
    expect(s.own?.vote).toBeNull();
  });

  it('clears trial accused when leaving trial phases', () => {
    let s = withGame();
    s.game = { ...s.game!, accusedSeat: 1 };
    s = apply(s, { v: PROTOCOL_VERSION, type: 'phase_change', phase: 'NIGHT', dayNumber: 2, endsAt: null });
    expect(s.game?.accusedSeat).toBeNull();
  });
});

describe('reduce: vote_update (BUILD_SPEC §6.3, §9.2)', () => {
  it('stores live tallies and per-seat votes', () => {
    let s = baseState();
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'game_started',
      seats: [seat(0), seat(1), seat(2)],
      setupId: 'x',
      config: {},
    });
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'vote_update',
      tallies: [{ seat: 1, weight: 2 }],
      votesBySeat: [
        { seat: 0, target: 1 },
        { seat: 2, target: 'skip' },
      ],
    });
    expect(s.game?.tallies).toEqual([{ seat: 1, weight: 2 }]);
    expect(s.game?.votesBySeat).toHaveLength(2);
  });

  it('ignores vote_update with no game (out-of-order safety)', () => {
    const s = baseState();
    const patch = reduce(s, ServerMessageSchema.parse({
      v: PROTOCOL_VERSION,
      type: 'vote_update',
      tallies: [],
      votesBySeat: [],
    }) as ServerMessage);
    expect(patch).toEqual({});
  });
});

describe('reduce: death handling (BUILD_SPEC §6.8, §13.1)', () => {
  function withGame(): StoreState {
    const s = baseState();
    return apply(s, {
      v: PROTOCOL_VERSION,
      type: 'game_started',
      seats: [seat(0), seat(1), seat(2)],
      setupId: 'x',
      config: {},
    });
  }

  it('marks the seat dead + revealed and queues the death feed', () => {
    let s = withGame();
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'death_announce',
      seat: 1,
      role: 'MAFIOSO',
      cause: 'lynch',
      lastWill: 'they got me',
    });
    const dead = s.game?.seats.find((x) => x.seat === 1);
    expect(dead?.alive).toBe(false);
    expect(dead?.role).toBe('MAFIOSO');
    expect(s.game?.deathFeed).toHaveLength(1);
    expect(s.game?.deathFeed[0]?.lastWill).toBe('they got me');
  });

  it('accumulates multiple dawn deaths in order', () => {
    let s = withGame();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'death_announce', seat: 0, role: 'DOCTOR', cause: 'mafia' });
    s = apply(s, { v: PROTOCOL_VERSION, type: 'death_announce', seat: 2, role: 'SHERIFF', cause: 'serial_killer' });
    expect(s.game?.deathFeed.map((d) => d.seat)).toEqual([0, 2]);
  });
});

describe('reduce: private_result, trial, errors, force_update', () => {
  it('appends a sheriff private result', () => {
    let s = baseState();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'game_started', seats: [seat(0)], setupId: 'x', config: {} });
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'private_result',
      kind: 'sheriff_result',
      target: 0,
      result: 'suspicious',
    } as ServerMessage);
    expect(s.privateLog).toHaveLength(1);
    expect(s.privateLog[0]?.payload.kind).toBe('sheriff_result');
  });

  it('records trial start and verdict result', () => {
    let s = baseState();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'game_started', seats: [seat(0), seat(1)], setupId: 'x', config: {} });
    s = apply(s, { v: PROTOCOL_VERSION, type: 'trial_start', accusedSeat: 1 });
    expect(s.game?.accusedSeat).toBe(1);
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'verdict_result',
      accusedSeat: 1,
      outcome: 'guilty',
      votes: [{ seat: 0, value: 'guilty' }],
    });
    expect(s.game?.lastVerdict?.outcome).toBe('guilty');
  });

  it('surfaces errors as toasts', () => {
    let s = baseState();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'error', code: 'rate_limited' });
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0]?.code).toBe('rate_limited');
  });

  it('flips to force_update on force_update', () => {
    let s = baseState();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'force_update', minProtocolVersion: 2 });
    expect(s.connection).toBe('force_update');
    expect(s.forceUpdateMin).toBe(2);
  });

  it('rehydrates from a welcome resume snapshot (BUILD_SPEC §8)', () => {
    let s = baseState();
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      guestId: 'g1',
      resume: {
        seat: 2,
        phase: 'DAY_VOTING',
        dayNumber: 3,
        endsAt: 99999,
        seats: [seat(0), seat(1), seat(2)],
        ownRole: 'JAILOR',
        ownFaction: 'TOWN',
        abilities: [{ id: 'execute', name: 'Execute', timing: 'night', usesRemaining: 2 }],
        privateLog: [{ kind: 'jailed' }],
        chatBacklog: [{ channel: 'day', from: 0, text: 'hi', ts: 1 }],
        lastWill: 'my will',
      },
    });
    expect(s.own?.role).toBe('JAILOR');
    expect(s.own?.seat).toBe(2);
    expect(s.own?.lastWill).toBe('my will');
    expect(s.game?.phase).toBe('DAY_VOTING');
    expect(s.chat).toHaveLength(1);
    expect(s.privateLog).toHaveLength(1);
  });
});

describe('reduce: text sanitization (BUILD_SPEC §11.6)', () => {
  it('strips control characters from chat text', () => {
    let s = baseState();
    s = apply(s, { v: PROTOCOL_VERSION, type: 'game_started', seats: [seat(0)], setupId: 'x', config: {} });
    s = apply(s, {
      v: PROTOCOL_VERSION,
      type: 'chat_message',
      channel: 'day',
      from: 0,
      text: 'hel\x00lo\x07',
      ts: 1,
    });
    expect(s.chat[0]?.text).toBe('hello');
  });
});
