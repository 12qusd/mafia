/**
 * Transport routing / leak-isolation tests (BUILD_SPEC §5).
 *
 * Proves the dispatcher maps 'public'/'mafia'/'dead'/SeatId[] onto exactly the
 * right sockets, and that spectators receive ONLY 'public' (never mafia/dead/
 * seat-addressed secrets), regardless of deadSeeAll.
 */

import { describe, it, expect } from 'vitest';
import { ScopedTransport, type AudienceProvider, type Sendable } from '../transport.js';
import type { Effect, SeatId, ServerMessage } from '@nocturne/shared';

class Recorder implements Sendable {
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
}

function msg(type: string, extra: Record<string, unknown> = {}): ServerMessage {
  return { v: 1, type, ...extra } as ServerMessage;
}

describe('ScopedTransport dispatcher (§5)', () => {
  // Seats 0,1 = mafia; 2,3 = town; 4 = dead. Spectator S receives public only.
  const seat0 = new Recorder();
  const seat1 = new Recorder();
  const seat2 = new Recorder();
  const seat3 = new Recorder();
  const seat4 = new Recorder();
  const spectator = new Recorder();
  const seatSock = new Map<SeatId, Recorder>([
    [0, seat0],
    [1, seat1],
    [2, seat2],
    [3, seat3],
    [4, seat4],
  ]);

  const audience: AudienceProvider = {
    publicSockets: () => [...seatSock.values(), spectator],
    socketsForSeats: (seats) => {
      const out: Sendable[] = [];
      for (const s of seats) {
        const sock = seatSock.get(s);
        if (sock) out.push(sock);
      }
      return out;
    },
    mafiaSeats: () => [0, 1],
    deadSeats: () => [4],
  };
  const t = new ScopedTransport(audience);

  it("'public' reaches every seat AND the spectator", () => {
    t.dispatchEffect({ to: 'public', msg: msg('phase_change', { phase: 'NIGHT', dayNumber: 1, endsAt: null }) });
    expect(spectator.sent.length).toBe(1);
    for (const r of seatSock.values()) expect(r.sent.length).toBe(1);
  });

  it("'mafia' reaches only mafia seats — not town, not dead, not spectator", () => {
    const before = spectator.sent.length;
    t.dispatchEffect({ to: 'mafia', msg: msg('chat_message', { channel: 'mafia', from: 0, text: 'plan', ts: 1 }) });
    expect(seat0.sent.at(-1)?.type).toBe('chat_message');
    expect(seat1.sent.at(-1)?.type).toBe('chat_message');
    // Town/dead/spectator did not receive the mafia secret.
    expect(seat2.sent.at(-1)?.type).not.toBe('chat_message');
    expect(seat4.sent.at(-1)?.type).not.toBe('chat_message');
    expect(spectator.sent.length).toBe(before);
  });

  it("'dead' reaches only dead seats — never the spectator", () => {
    const before = spectator.sent.length;
    t.dispatchEffect({ to: 'dead', msg: msg('chat_message', { channel: 'dead', from: 4, text: 'rip', ts: 2 }) });
    expect(seat4.sent.at(-1)?.text).toBe('rip');
    expect(spectator.sent.length).toBe(before);
    expect(seat0.sent.at(-1)?.text).not.toBe('rip');
  });

  it('SeatId[] addresses exactly the listed seats (your_role/private_result)', () => {
    const before = spectator.sent.length;
    const effect: Effect = { to: [2], msg: msg('your_role', { role: 'DOCTOR', faction: 'TOWN', abilities: [] }) };
    t.dispatchEffect(effect);
    expect(seat2.sent.at(-1)?.role).toBe('DOCTOR');
    expect(seat3.sent.at(-1)?.role).not.toBe('DOCTOR');
    expect(spectator.sent.length).toBe(before);
  });
});
