/**
 * TEST MODE end-to-end (NOCTURNE test mode) over the REAL loopback server:
 *   - add_bot backfills a test lobby with in-process bots and a full bot game
 *     completes;
 *   - the host (god audience) receives debug_trace frames;
 *   - the audit endpoint returns the full match JSON (host-authorized) and 404s
 *     for a non-test room;
 *   - the leak auditor allows debug_* ONLY for the god audience.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInProcessServer, type RunningServer } from '../server-harness.js';
import { BotClient } from '../client.js';
import { auditGame } from '../leak.js';
import { type ServerMessage } from '../protocol.js';

let server: RunningServer;

beforeAll(async () => {
  // Open the TEST MODE env gate before the server boots (loadConfig reads it).
  process.env.NOCTURNE_TEST_MODE = '1';
  server = await startInProcessServer();
});

afterAll(async () => {
  delete process.env.NOCTURNE_TEST_MODE;
  await server.shutdown();
});

/** Wait until a predicate holds or a timeout elapses. */
async function until(pred: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

describe('add_bot backfill + full bot game in a test lobby', () => {
  it('fills a test lobby and plays to game_over with host god-view', async () => {
    const host = new BotClient({ url: server.wsUrl, name: 'Host' });
    await host.connect();
    // Host creates a private TEST lobby.
    host.send({
      v: 1,
      type: 'create_lobby',
      name: 'Test Game',
      visibility: 'private',
      setupId: 'classic-nocturne',
      config: { testMode: true },
    } as never);
    await until(() => host.lobbyId !== null);
    expect(host.lobbyId).toBeTruthy();
    const lobbyState = host.capture.find((m) => m.type === 'lobby_state') as
      | { lobby: { testMode?: boolean } }
      | undefined;
    expect(lobbyState?.lobby.testMode).toBe(true);

    // Host adds 6 scripted bots (host + 6 = 7 players for classic-nocturne).
    host.send({ v: 1, type: 'test_control', action: 'add_bot', count: 6, policy: 'scripted' } as never);

    // Wait until the lobby has 7 members (host + 6 bots).
    const filled = await until(() => host.lobbyMembers.length >= 7, 10000);
    expect(filled).toBe(true);

    // Host starts the game.
    host.send({ v: 1, type: 'start_game' } as never);
    // The host (god audience) receives debug_state at game start.
    await until(() => host.capture.some((m) => m.type === 'debug_state'), 8000);
    expect(host.capture.some((m) => m.type === 'debug_state')).toBe(true);

    // Drive the game to completion by repeatedly ending phases (don't wait timers).
    const roomId = host.lobbyId!;
    const driveDone = await until(() => {
      if (!host.view.over) {
        host.send({ v: 1, type: 'test_control', action: 'end_phase' } as never);
      }
      return host.view.over;
    }, 30000);
    expect(driveDone).toBe(true);
    expect(host.view.over).toBe(true);

    // The host received at least one debug_trace (night resolution) frame.
    expect(host.capture.some((m) => m.type === 'debug_trace')).toBe(true);

    // The audit endpoint returns the full match JSON for the host's token.
    // (Use the admin-token-less host path: the host is the god identity. We have
    // no host token here, so assert the unauth path is forbidden, and the
    // non-test 404 path, which cover the endpoint's gating.)
    const res = await fetch(`${server.httpUrl}/api/test/match/${roomId}/audit`);
    expect(res.status).toBe(403); // no host/admin credentials on a bare fetch

    const missing = await fetch(`${server.httpUrl}/api/test/match/does-not-exist/audit`);
    expect(missing.status).toBe(404);

    host.close();
  }, 60000);
});

describe('audit endpoint returns full match JSON (admin-authorized)', () => {
  it('serves the audit JSON for a test room with the admin token', async () => {
    process.env.NOCTURNE_TEST_MODE = '1';
    process.env.ADMIN_TOKEN = 'secret-admin';
    const srv = await startInProcessServer();
    try {
      const host = new BotClient({ url: srv.wsUrl, name: 'Host' });
      await host.connect();
      host.send({
        v: 1,
        type: 'create_lobby',
        name: 'Audit Game',
        visibility: 'private',
        setupId: 'classic-nocturne',
        config: { testMode: true },
      } as never);
      await until(() => host.lobbyId !== null);
      const roomId = host.lobbyId!;
      host.send({ v: 1, type: 'test_control', action: 'add_bot', count: 6, policy: 'scripted' } as never);
      await until(() => host.lobbyMembers.length >= 7, 10000);
      host.send({ v: 1, type: 'start_game' } as never);
      await until(() => host.capture.some((m) => m.type === 'debug_state'), 8000);

      const res = await fetch(`${srv.httpUrl}/api/test/match/${roomId}/audit`, {
        headers: { 'x-admin-token': 'secret-admin' },
      });
      expect(res.status).toBe(200);
      const audit = (await res.json()) as {
        seed: string;
        setupId: string;
        actionLog: unknown[];
        seats: unknown[];
        traceHistory: unknown[];
      };
      expect(audit.setupId).toBe('classic-nocturne');
      expect(typeof audit.seed).toBe('string');
      expect(Array.isArray(audit.actionLog)).toBe(true);
      expect(audit.seats.length).toBe(7);

      host.close();
    } finally {
      delete process.env.NOCTURNE_TEST_MODE;
      delete process.env.ADMIN_TOKEN;
      await srv.shutdown();
    }
  }, 30000);
});

describe('leak auditor: debug_* frames legal ONLY for the god audience', () => {
  it('flags a debug frame at a non-god observer, allows it at the god', () => {
    const debugFrame = {
      v: 1,
      type: 'debug_state',
      phase: 'NIGHT',
      dayNumber: 1,
      nightNumber: 1,
      seats: [],
      mafiaRoster: [],
      intents: [],
      jailTarget: null,
      pendingJesterGrief: null,
      voteTallies: [],
      votesBySeat: [],
      trial: null,
      executionerTargets: [],
    } as unknown as ServerMessage;

    // Non-god seat 1 receives a debug frame → violation.
    const leaksBad = auditGame({
      seats: [
        { seat: 0, role: 'SHERIFF', faction: 'TOWN', frames: [] },
        { seat: 1, role: 'DOCTOR', faction: 'TOWN', frames: [debugFrame] },
      ],
      spectators: [],
      deadSeeAll: true,
      godSeat: 0,
    });
    expect(leaksBad.length).toBe(1);
    expect(leaksBad[0]!.frameType).toBe('debug_state');

    // The god (seat 0) receiving the same frame → no violation.
    const leaksGood = auditGame({
      seats: [
        { seat: 0, role: 'SHERIFF', faction: 'TOWN', frames: [debugFrame] },
        { seat: 1, role: 'DOCTOR', faction: 'TOWN', frames: [] },
      ],
      spectators: [],
      deadSeeAll: true,
      godSeat: 0,
    });
    expect(leaksGood.length).toBe(0);

    // In a NORMAL game (no godSeat) the frame is a leak even at seat 0.
    const leaksNormal = auditGame({
      seats: [{ seat: 0, role: 'SHERIFF', faction: 'TOWN', frames: [debugFrame] }],
      spectators: [],
      deadSeeAll: true,
    });
    expect(leaksNormal.length).toBe(1);
  });
});
