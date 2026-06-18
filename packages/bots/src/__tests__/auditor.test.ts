/**
 * Auditor unit tests (BUILD_SPEC §5, §12.3).
 *
 * Proves the leak auditor has TEETH: it must flag a deliberately injected leak.
 * A passing leak.test.ts only proves "no leak found"; this proves the detector
 * would catch one. Also pins determinism of the engine FAST simulator (§12.1).
 */

import { describe, it, expect } from 'vitest';
import { auditGame, type AuditSeat } from '../leak.js';
import { playEngineGame } from '../sim-engine.js';
import type { ServerMessage } from '../protocol.js';

function seat(s: number, role: string, faction: string, frames: ServerMessage[]): AuditSeat {
  return { seat: s, role, faction, frames };
}

describe('leak auditor has teeth (§12.3)', () => {
  it('flags a non-evil seat that received a faction roster (mates)', () => {
    const frames: ServerMessage[] = [
      { v: 1, type: 'your_role', role: 'CITIZEN', faction: 'TOWN', abilities: [], mates: [1, 2] },
    ];
    const v = auditGame({
      seats: [
        seat(0, 'CITIZEN', 'TOWN', frames),
        seat(1, 'GODFATHER', 'MAFIA', []),
        seat(2, 'MAFIOSO', 'MAFIA', []),
      ],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.reason.includes('faction roster'))).toBe(true);
  });

  it('flags a non-triad seat that received a triad roster (mates)', () => {
    // A Mafia seat receiving the TRIAD roster is a leak — the two evil factions
    // must never learn each other's members.
    const frames: ServerMessage[] = [
      { v: 1, type: 'your_role', role: 'GODFATHER', faction: 'MAFIA', abilities: [], mates: [2, 3] },
    ];
    const v = auditGame({
      seats: [
        seat(0, 'GODFATHER', 'MAFIA', frames),
        seat(1, 'CITIZEN', 'TOWN', []),
        seat(2, 'DRAGON_HEAD', 'TRIAD', []),
        seat(3, 'ENFORCER', 'TRIAD', []),
      ],
      spectators: [],
      deadSeeAll: true,
    });
    // The Mafia GF legitimately carries Mafia mates only — here mates=[2,3] are
    // TRIAD seats, so the deep scan / roster check must flag the cross-faction leak.
    expect(v.length).toBeGreaterThan(0);
  });

  it('flags a non-triad seat that received triad night chat', () => {
    // A Mafia seat receiving 'triad' chat is a leak (mirror of the mafia-chat case).
    const mafiaObserver: ServerMessage[] = [
      { v: 1, type: 'chat_message', channel: 'triad', from: 2, text: 'tonight: 0', ts: 1 },
    ];
    const v = auditGame({
      seats: [
        seat(0, 'GODFATHER', 'MAFIA', mafiaObserver),
        seat(1, 'CITIZEN', 'TOWN', []),
        seat(2, 'DRAGON_HEAD', 'TRIAD', []),
      ],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v.some((x) => x.reason.includes('triad night chat'))).toBe(true);
  });

  it('a triad seat legitimately receiving triad chat + triad mates is NOT a leak', () => {
    const triadObserver: ServerMessage[] = [
      { v: 1, type: 'your_role', role: 'DRAGON_HEAD', faction: 'TRIAD', abilities: [], mates: [1] },
      { v: 1, type: 'chat_message', channel: 'triad', from: 1, text: 'tonight: 2', ts: 1 },
    ];
    const v = auditGame({
      seats: [
        seat(0, 'DRAGON_HEAD', 'TRIAD', triadObserver),
        seat(1, 'ENFORCER', 'TRIAD', []),
        seat(2, 'CITIZEN', 'TOWN', []),
      ],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v).toEqual([]);
  });

  it('flags a spectator that received mafia chat', () => {
    const specFrames: ServerMessage[] = [
      { v: 1, type: 'chat_message', channel: 'mafia', from: 1, text: 'kill 0', ts: 1 },
    ];
    const v = auditGame({
      seats: [seat(0, 'CITIZEN', 'TOWN', []), seat(1, 'GODFATHER', 'MAFIA', [])],
      spectators: [{ frames: specFrames }],
      deadSeeAll: true,
    });
    expect(v.some((x) => x.observerIsSpectator)).toBe(true);
  });

  it("flags a frame leaking another unrevealed seat's role in a STRUCTURED field", () => {
    // Simulate a server bug: a public game_started whose seat list accidentally
    // carries the role of a LIVING (unrevealed) seat 1 — a structured leak that
    // §12.3 must catch. (PublicSeat.role must be absent for living seats, §5.)
    const leaky = {
      v: 1,
      type: 'game_started',
      setupId: 'classic-nocturne',
      config: {},
      seats: [
        { seat: 0, name: 'a', alive: true, connected: true, afk: false },
        { seat: 1, name: 'b', alive: true, connected: true, afk: false, role: 'GODFATHER', faction: 'MAFIA' },
      ],
    } as unknown as ServerMessage;
    const v = auditGame({
      seats: [seat(0, 'CITIZEN', 'TOWN', [leaky]), seat(1, 'GODFATHER', 'MAFIA', [])],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v.some((x) => x.reason.includes('unrevealed role'))).toBe(true);
  });

  it('does NOT flag a day-chat role CLAIM (free text, not a structured leak)', () => {
    // A player claiming a role in chat is normal play, not a leak (§6 claims).
    const frames: ServerMessage[] = [
      { v: 1, type: 'chat_message', channel: 'day', from: 1, text: 'I am the GODFATHER', ts: 1 },
    ];
    const v = auditGame({
      seats: [seat(0, 'CITIZEN', 'TOWN', frames), seat(1, 'GODFATHER', 'MAFIA', [])],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v).toEqual([]);
  });

  it('does NOT flag a legal reveal: role string after death_announce', () => {
    const frames: ServerMessage[] = [
      { v: 1, type: 'death_announce', seat: 1, role: 'GODFATHER', cause: 'mafia' },
      // Now seat 1's role is public; a later frame echoing it is fine.
      { v: 1, type: 'chat_message', channel: 'day', from: 0, text: 'so 1 was GODFATHER', ts: 2 },
    ];
    const v = auditGame({
      seats: [seat(0, 'CITIZEN', 'TOWN', frames), seat(1, 'GODFATHER', 'MAFIA', [])],
      spectators: [],
      deadSeeAll: true,
    });
    expect(v).toEqual([]);
  });
});

describe('engine FAST sim determinism (§12.1)', () => {
  it('same seed ⇒ identical fingerprint', () => {
    const a = playEngineGame({ players: 9, seed: 'det-1', setupId: 'classic-nocturne' });
    const b = playEngineGame({ players: 9, seed: 'det-1', setupId: 'classic-nocturne' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.winners).toEqual(b.winners);
  });

  it('different seeds generally differ', () => {
    const fps = new Set<string>();
    for (let g = 0; g < 25; g++) {
      fps.add(playEngineGame({ players: 9, seed: `div-${g}`, setupId: 'classic-nocturne' }).fingerprint);
    }
    // Expect meaningful variety across seeds (role layouts + outcomes).
    expect(fps.size).toBeGreaterThan(5);
  });
});
