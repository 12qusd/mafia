import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  safeParseServerMessage,
  ClientMessageSchema,
  ServerMessageSchema,
} from './index.js';
import { PROTOCOL_VERSION } from '../constants.js';

const V = PROTOCOL_VERSION;

/**
 * One concrete, spec-faithful example per §9.1 client message. Every example
 * must round-trip through the discriminated union.
 */
const CLIENT_EXAMPLES: Record<string, unknown> = {
  hello: { v: V, type: 'hello', token: 'abc', protocolVersion: V },
  hello_no_token: { v: V, type: 'hello', protocolVersion: V },
  create_lobby: {
    v: V,
    type: 'create_lobby',
    name: 'Speakeasy',
    visibility: 'private',
    setupId: 'classic-nocturne',
    config: { whispersEnabled: true },
  },
  join_lobby_code: { v: V, type: 'join_lobby', inviteCode: 'ABC123', asSpectator: false },
  join_lobby_id: { v: V, type: 'join_lobby', lobbyId: 'lobby-1' },
  leave_lobby: { v: V, type: 'leave_lobby' },
  lobby_config: { v: V, type: 'lobby_config', config: { deadSeeAll: false } },
  kick_seat: { v: V, type: 'kick', seatOrUserId: 3 },
  kick_user: { v: V, type: 'kick', seatOrUserId: 'user-9' },
  start_game: { v: V, type: 'start_game' },
  chat: { v: V, type: 'chat', channel: 'day', text: 'I think 4 is mafia.' },
  whisper: { v: V, type: 'whisper', toSeat: 7, text: 'are you town?' },
  vote_seat: { v: V, type: 'vote', target: 5 },
  vote_skip: { v: V, type: 'vote', target: 'skip' },
  vote_retract: { v: V, type: 'vote', target: null },
  verdict: { v: V, type: 'verdict', value: 'guilty' },
  night_action: { v: V, type: 'night_action', ability: 'kill', target: 2 },
  night_action_cancel: { v: V, type: 'night_action', ability: 'kill', target: null },
  day_ability_jail: { v: V, type: 'day_ability', ability: 'jail', target: 6 },
  day_ability_reveal: { v: V, type: 'day_ability', ability: 'reveal' },
  last_will: { v: V, type: 'last_will', text: 'N1 checked seat 3: suspicious.' },
  death_note: { v: V, type: 'death_note', text: 'A gift from the family.' },
  report_player: { v: V, type: 'report_player', seat: 8, category: 'harassment', comment: 'slurs' },
  ping: { v: V, type: 'ping', t: 123456 },
};

/** One concrete example per §9.2 server message. */
const SERVER_EXAMPLES: Record<string, unknown> = {
  welcome: { v: V, type: 'welcome', userId: 'u1' },
  welcome_guest: { v: V, type: 'welcome', guestId: 'g1' },
  lobby_state: {
    v: V,
    type: 'lobby_state',
    lobby: {
      id: 'lobby-1',
      name: 'Speakeasy',
      visibility: 'private',
      setupId: 'classic-nocturne',
      config: {},
      hostUserOrGuestId: 'u1',
      members: [
        { userOrGuestId: 'u1', name: 'Ace', isHost: true, isSpectator: false, connected: true },
      ],
      spectatorCount: 0,
      status: 'waiting',
    },
  },
  game_started: {
    v: V,
    type: 'game_started',
    seats: [{ seat: 0, name: 'Ace', alive: true, connected: true, afk: false }],
    setupId: 'classic-nocturne',
    config: {},
  },
  your_role: {
    v: V,
    type: 'your_role',
    role: 'GODFATHER',
    faction: 'MAFIA',
    abilities: [{ id: 'control', name: 'Order the kill', timing: 'night', usesRemaining: null }],
    mates: [3, 5],
  },
  phase_change: { v: V, type: 'phase_change', phase: 'NIGHT', dayNumber: 1, endsAt: 1_700_000_000 },
  phase_change_no_deadline: {
    v: V,
    type: 'phase_change',
    phase: 'GAME_OVER',
    dayNumber: 4,
    endsAt: null,
  },
  chat_message: { v: V, type: 'chat_message', channel: 'day', from: 2, text: 'hi', ts: 1 },
  chat_message_jailor: {
    v: V,
    type: 'chat_message',
    channel: 'jail',
    from: 'Jailor',
    text: 'who?',
    ts: 2,
  },
  whisper_meta: { v: V, type: 'whisper_meta', fromSeat: 1, toSeat: 2 },
  whisper: { v: V, type: 'whisper', fromSeat: 1, text: 'secret' },
  vote_update: {
    v: V,
    type: 'vote_update',
    tallies: [{ seat: 4, weight: 3 }],
    votesBySeat: [
      { seat: 1, target: 4 },
      { seat: 2, target: 'skip' },
    ],
  },
  trial_start: { v: V, type: 'trial_start', accusedSeat: 4 },
  verdict_result: {
    v: V,
    type: 'verdict_result',
    accusedSeat: 4,
    outcome: 'guilty',
    votes: [
      { seat: 1, value: 'guilty' },
      { seat: 2, value: 'abstain' },
    ],
  },
  death_announce: {
    v: V,
    type: 'death_announce',
    seat: 4,
    role: 'MAFIOSO',
    lastWill: 'nothing',
    deathNote: 'regards',
    cause: 'lynch',
  },
  private_result_sheriff: {
    v: V,
    type: 'private_result',
    kind: 'sheriff_result',
    target: 3,
    result: 'suspicious',
  },
  private_result_invest: {
    v: V,
    type: 'private_result',
    kind: 'investigator_result',
    target: 3,
    resultClass: 'R6',
  },
  private_result_lookout: {
    v: V,
    type: 'private_result',
    kind: 'lookout_result',
    target: 3,
    visitors: [1, 5],
  },
  private_result_distracted: { v: V, type: 'private_result', kind: 'roleblocked' },
  private_result_healed: { v: V, type: 'private_result', kind: 'was_healed' },
  day_ability_ack: { v: V, type: 'day_ability_ack', ability: 'jail', target: 6 },
  game_over: {
    v: V,
    type: 'game_over',
    winners: ['MAFIA'],
    allRoles: [{ seat: 0, role: 'GODFATHER', faction: 'MAFIA', outcome: 'win' }],
    seed: 'deadbeef',
    matchId: 'm1',
  },
  seat_status: { v: V, type: 'seat_status', seat: 3, connected: false, afk: true },
  error: { v: V, type: 'error', code: 'wrong_phase', detail: 'not voting now' },
  pong: { v: V, type: 'pong', t: 99 },
  force_update: { v: V, type: 'force_update', minProtocolVersion: 2 },
};

describe('client message schemas (§9.1)', () => {
  for (const [label, msg] of Object.entries(CLIENT_EXAMPLES)) {
    it(`parses ${label}`, () => {
      expect(() => parseClientMessage(msg)).not.toThrow();
    });
  }

  it('covers every client message type', () => {
    const types = new Set(Object.values(CLIENT_EXAMPLES).map((m) => (m as { type: string }).type));
    const expected = [
      'hello',
      'create_lobby',
      'join_lobby',
      'leave_lobby',
      'lobby_config',
      'kick',
      'start_game',
      'chat',
      'whisper',
      'vote',
      'verdict',
      'night_action',
      'day_ability',
      'last_will',
      'death_note',
      'report_player',
      'ping',
    ];
    for (const t of expected) expect(types.has(t)).toBe(true);
  });
});

describe('server message schemas (§9.2)', () => {
  for (const [label, msg] of Object.entries(SERVER_EXAMPLES)) {
    it(`parses ${label}`, () => {
      expect(() => parseServerMessage(msg)).not.toThrow();
    });
  }

  it('covers every server message type', () => {
    const types = new Set(Object.values(SERVER_EXAMPLES).map((m) => (m as { type: string }).type));
    const expected = [
      'welcome',
      'lobby_state',
      'game_started',
      'your_role',
      'phase_change',
      'chat_message',
      'whisper_meta',
      'whisper',
      'vote_update',
      'trial_start',
      'verdict_result',
      'death_announce',
      'private_result',
      'day_ability_ack',
      'game_over',
      'seat_status',
      'error',
      'pong',
      'force_update',
    ];
    for (const t of expected) expect(types.has(t)).toBe(true);
  });
});

describe('rejection & robustness (§9, §12.4)', () => {
  it('rejects unknown type', () => {
    expect(safeParseClientMessage({ v: V, type: 'nope' }).success).toBe(false);
  });

  it('rejects wrong protocol version', () => {
    expect(safeParseClientMessage({ v: 99, type: 'ping', t: 1 }).success).toBe(false);
  });

  it('rejects missing envelope', () => {
    expect(safeParseClientMessage({ type: 'ping', t: 1 }).success).toBe(false);
  });

  it('rejects join_lobby with neither id nor code', () => {
    expect(safeParseClientMessage({ v: V, type: 'join_lobby' }).success).toBe(false);
  });

  it('rejects oversized chat text', () => {
    const big = 'x'.repeat(10_000);
    expect(safeParseClientMessage({ v: V, type: 'chat', channel: 'day', text: big }).success).toBe(
      false,
    );
  });

  it('rejects timings out of bounds', () => {
    const msg = {
      v: V,
      type: 'create_lobby',
      name: 'x',
      visibility: 'public',
      setupId: 'classic-nocturne',
      config: { timings: { NIGHT: 9999 } },
    };
    expect(safeParseClientMessage(msg).success).toBe(false);
  });

  it('never throws on arbitrary garbage', () => {
    const garbage: unknown[] = [null, 42, 'str', [], { v: V }, { foo: 'bar' }];
    for (const g of garbage) {
      expect(safeParseClientMessage(g).success).toBe(false);
      expect(safeParseServerMessage(g).success).toBe(false);
    }
  });

  it('safeParse returns typed data on success', () => {
    const r = safeParseClientMessage(CLIENT_EXAMPLES.ping);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe('ping');
  });

  // Sanity: the union schemas exist and are usable.
  it('exposes the union schemas', () => {
    expect(ClientMessageSchema).toBeDefined();
    expect(ServerMessageSchema).toBeDefined();
  });
});
