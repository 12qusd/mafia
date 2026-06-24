/**
 * "Play again" / rematch end-to-end (§7.7) over the REAL loopback server.
 *
 * Drives a full bot game to `game_over`, then proves the rematch loop the
 * GameOver UI depends on:
 *   - the FIRST finished player to send `play_again` lands in a FRESH WAITING
 *     lobby (a brand-new lobby id, status !== 'in_game'), as its host;
 *   - a SECOND finished player who sends `play_again` JOINS the SAME lobby (same
 *     id, the roster grows);
 *   - the rematch lobby is a NORMAL game (the test/god lobby is not inherited).
 *
 * The first game runs in TEST MODE only so the host can drive it to completion
 * with `end_phase` (no wall-clock waits). The rematch itself is forced to a
 * normal game by the server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInProcessServer, type RunningServer } from '../server-harness.js';
import { BotClient } from '../client.js';

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

describe('play again / rematch over the real socket (§7.7)', () => {
  it('first player creates a fresh waiting lobby; a second joins the same lobby', async () => {
    const host = new BotClient({ url: server.wsUrl, name: 'Host' });
    const guest = new BotClient({ url: server.wsUrl, name: 'Guest' });
    await host.connect();
    await guest.connect();

    // Host creates a private TEST lobby (so we can drive it via end_phase).
    host.send({
      v: 1,
      type: 'create_lobby',
      name: 'Rematch Game',
      visibility: 'private',
      setupId: 'classic-nocturne',
      config: { testMode: true },
    } as never);
    await until(() => host.lobbyId !== null);
    const gameLobbyId = host.lobbyId!;

    // A second human joins by lobby id (private lobbies are joinable by id).
    guest.send({ v: 1, type: 'join_lobby', lobbyId: gameLobbyId } as never);
    await until(() => guest.lobbyId === gameLobbyId);
    expect(guest.lobbyId).toBe(gameLobbyId);

    // Host backfills 5 scripted bots (host + guest + 5 = 7 for classic-nocturne).
    host.send({ v: 1, type: 'test_control', action: 'add_bot', count: 5, policy: 'scripted' } as never);
    const filled = await until(() => host.lobbyMembers.length >= 7, 10000);
    expect(filled).toBe(true);

    // Host starts; drive to completion via repeated end_phase (no timer waits).
    host.send({ v: 1, type: 'start_game' } as never);
    await until(() => host.capture.some((m) => m.type === 'debug_state'), 8000);
    const driveDone = await until(() => {
      if (!host.view.over) host.send({ v: 1, type: 'test_control', action: 'end_phase' } as never);
      return host.view.over;
    }, 30000);
    expect(driveDone).toBe(true);
    expect(host.view.over && guest.view.over).toBe(true);

    // FIRST player ("play again"): lands in a FRESH WAITING lobby as its host.
    host.send({ v: 1, type: 'play_again' } as never);
    const movedToRematch = await until(() => host.lobbyId !== null && host.lobbyId !== gameLobbyId, 8000);
    expect(movedToRematch).toBe(true);
    const rematchLobbyId = host.lobbyId!;
    expect(rematchLobbyId).not.toBe(gameLobbyId);
    // The latest lobby_state is the rematch lobby: waiting, host = this client.
    const created = [...host.capture].reverse().find((m) => m.type === 'lobby_state') as
      | { lobby: { id: string; status: string; testMode?: boolean } }
      | undefined;
    expect(created?.lobby.id).toBe(rematchLobbyId);
    expect(created?.lobby.status).not.toBe('in_game');
    // A rematch is a NORMAL game — the test/god lobby is NOT inherited.
    expect(created?.lobby.testMode).not.toBe(true);
    expect(host.isHost).toBe(true);
    expect(host.lobbyMembers.length).toBe(1);

    // SECOND player ("play again"): JOINS the SAME lobby; the roster grows to 2.
    guest.send({ v: 1, type: 'play_again' } as never);
    const joined = await until(() => guest.lobbyId === rematchLobbyId, 8000);
    expect(joined).toBe(true);
    expect(guest.lobbyId).toBe(rematchLobbyId);
    const grew = await until(() => host.lobbyMembers.length >= 2, 8000);
    expect(grew).toBe(true);

    host.close();
    guest.close();
  }, 60000);
});
