import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  ClientMessageSchema,
  safeParseServerMessage,
  safeParseClientMessage,
  type ClientMessage,
} from '@nocturne/shared';

describe('outbound client message round-trip (BUILD_SPEC §9.1)', () => {
  const messages: ClientMessage[] = [
    { v: PROTOCOL_VERSION, type: 'hello', protocolVersion: PROTOCOL_VERSION },
    { v: PROTOCOL_VERSION, type: 'create_lobby', name: 'Blind Tiger', visibility: 'private', setupId: 'classic-nocturne' },
    { v: PROTOCOL_VERSION, type: 'join_lobby', inviteCode: 'ABC123' },
    { v: PROTOCOL_VERSION, type: 'chat', channel: 'day', text: 'hello' },
    { v: PROTOCOL_VERSION, type: 'whisper', toSeat: 3, text: 'meet me' },
    { v: PROTOCOL_VERSION, type: 'vote', target: 5 },
    { v: PROTOCOL_VERSION, type: 'vote', target: 'skip' },
    { v: PROTOCOL_VERSION, type: 'vote', target: null },
    { v: PROTOCOL_VERSION, type: 'verdict', value: 'guilty' },
    { v: PROTOCOL_VERSION, type: 'night_action', ability: 'protect', target: 2 },
    { v: PROTOCOL_VERSION, type: 'night_action', ability: 'protect', target: null },
    { v: PROTOCOL_VERSION, type: 'day_ability', ability: 'jail', target: 4 },
    { v: PROTOCOL_VERSION, type: 'day_ability', ability: 'reveal' },
    { v: PROTOCOL_VERSION, type: 'last_will', text: 'my will' },
    { v: PROTOCOL_VERSION, type: 'death_note', text: 'a card' },
    { v: PROTOCOL_VERSION, type: 'report_player', seat: 1, category: 'spam' },
    { v: PROTOCOL_VERSION, type: 'ping', t: 123 },
  ];

  it('every constructed message validates against the shared schema', () => {
    for (const m of messages) {
      const parsed = ClientMessageSchema.safeParse(m);
      expect(parsed.success, JSON.stringify(m)).toBe(true);
    }
  });

  it('rejects an invalid client message', () => {
    expect(safeParseClientMessage({ v: PROTOCOL_VERSION, type: 'chat', channel: 'nope', text: 'x' }).success).toBe(false);
    expect(safeParseClientMessage({ type: 'chat' }).success).toBe(false);
  });
});

describe('inbound server message validation (BUILD_SPEC §9.2, §13 resilience)', () => {
  it('parses a well-formed welcome', () => {
    const r = safeParseServerMessage({ v: PROTOCOL_VERSION, type: 'welcome', guestId: 'g1' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown message types gracefully', () => {
    const r = safeParseServerMessage({ v: PROTOCOL_VERSION, type: 'definitely_not_a_message' });
    expect(r.success).toBe(false);
  });

  it('rejects a wrong protocol version', () => {
    const r = safeParseServerMessage({ v: 99, type: 'pong', t: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects malformed JSON-ish garbage without throwing', () => {
    expect(() => safeParseServerMessage(null)).not.toThrow();
    expect(safeParseServerMessage(null).success).toBe(false);
    expect(safeParseServerMessage(42).success).toBe(false);
  });
});
