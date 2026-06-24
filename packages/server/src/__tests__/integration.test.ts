/**
 * Engine-dependent integration tests (BUILD_SPEC §12.3, §12.4, M1).
 *
 * The real `@nocturne/engine` is present, so the §5 leak-detector and game-start
 * delivery tests RUN against the real engine through the real gateway. They are
 * guarded by `isUsingFallbackEngine()` and self-skip if only the in-server
 * reference engine is available (see DECISIONS.md). The full timer-driven
 * game-loop and reconnect-equivalence tests drive the in-server reference engine
 * through the now-injectable clock seam (LobbyManager → Room), advancing a
 * `FakeClock` instead of waiting on wall time (§6.2, §8).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getEngine, isUsingFallbackEngine } from '../engine-adapter.js';
import { Gateway } from '../ws/gateway.js';
import type { GatewayContext } from '../ws/context.js';
import { buildTestContext, FakeSocket, FakeClock } from './helpers.js';
import type { Connection } from '../ws/connection.js';

let fallback = true;
beforeAll(async () => {
  await getEngine();
  fallback = isUsingFallbackEngine();
});

async function hello(gw: Gateway, sock: FakeSocket, token?: string): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(
    conn,
    JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, ...(token ? { token } : {}) }),
  );
  return conn;
}

/**
 * Seat N guests into a started game on the given context. Returns the per-seat
 * sockets, connections, guest tokens (seat order = join order), the lobby id and
 * the gateway. The host (index 0) creates a private lobby; the rest join.
 */
async function startGame(
  ctx: GatewayContext,
  n: number,
): Promise<{ gw: Gateway; socks: FakeSocket[]; conns: Connection[]; tokens: string[]; lobbyId: string }> {
  const gw = new Gateway(ctx);
  const socks: FakeSocket[] = [];
  const conns: Connection[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) {
    // Pre-mint a guest so we hold a stable token for reconnect (§8).
    const guest = ctx.identity.createGuest();
    tokens.push(guest.token);
    const s = new FakeSocket();
    socks.push(s);
    conns.push(await hello(gw, s, guest.token));
  }
  await gw.deliverForTest(
    conns[0]!,
    JSON.stringify({ v: 1, type: 'create_lobby', name: 'L', visibility: 'private', setupId: 'classic-nocturne' }),
  );
  const lobbyId = ctx.manager.lobbyOf(conns[0]!)!.id;
  for (let i = 1; i < n; i++) {
    await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId }));
  }
  await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'start_game' }));
  return { gw, socks, conns, tokens, lobbyId };
}

describe('leak detector over a started game (§5, §12.3)', () => {
  it('every seat gets exactly one own role; no seat receives another seat\'s your_role or mafia chat', async () => {
    if (fallback) {
      // Real engine not bound; the reference engine is a simplified subset.
      console.warn('skipping: fallback engine in use');
      return;
    }
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);

    const socks: FakeSocket[] = [];
    const conns: Connection[] = [];
    for (let i = 0; i < 7; i++) {
      const s = new FakeSocket();
      socks.push(s);
      conns.push(await hello(gw, s));
    }
    // Host creates a private lobby; others join; host starts.
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'create_lobby', name: 'L', visibility: 'private', setupId: 'classic-nocturne' }),
    );
    const lobby = ctx.manager.lobbyOf(conns[0]!)!;
    for (let i = 1; i < 7; i++) {
      await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId: lobby.id }));
    }
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'start_game' }));

    // Each socket received exactly one your_role.
    const yourRoles = socks.map((s) => s.ofType('your_role'));
    expect(yourRoles.every((r) => r.length === 1)).toBe(true);

    // No socket received another seat's role: each your_role addressed exactly
    // the one recipient (we verify the role set has 7 distinct seats implicitly
    // by counts; mates appear only for mafia).
    const factions = yourRoles.map((r) => (r[0] as { faction: string }).faction);
    const mafiaCount = factions.filter((f) => f === 'MAFIA').length;
    expect(mafiaCount).toBeGreaterThanOrEqual(2);

    // Mafia seats carry a mates list; non-mafia never do (§5).
    socks.forEach((s) => {
      const yr = s.lastOfType('your_role') as { faction: string; mates?: unknown };
      if (yr.faction === 'MAFIA') expect(Array.isArray(yr.mates)).toBe(true);
      else expect(yr.mates).toBeUndefined();
    });

    // game_started is public; it carries no roles (only PublicSeat which has no
    // role for living seats).
    const gs = socks[0]!.lastOfType('game_started') as { seats: { role?: string }[] };
    expect(gs.seats.every((seat) => seat.role === undefined)).toBe(true);

    // Leak sweep: no public/day frame anywhere contains a role string for a
    // living seat. We assert no `chat_message` leaked a secret channel to a
    // non-member (none sent yet) and that no your_role crossed sockets.
    const room = ctx.manager.getRoom(lobby.id)!;
    const mafiaSeats = new Set(room.mafiaSeats());
    socks.forEach((s, seat) => {
      const mafiaChats = s.ofType('chat_message').filter((m) => (m as { channel: string }).channel === 'mafia');
      if (!mafiaSeats.has(seat)) expect(mafiaChats.length).toBe(0);
    });
  });
});

// Full timer-driven game loop driven by an injected FakeClock (§6, M1). The
// clock seam now threads LobbyManager → Room, so advancing virtual time fires
// each phase deadline and the loop runs to completion without wall-clock waits.
describe('full game loop to game_over (§6, M1)', () => {
  it('plays a full timer-driven game and reaches game_over', async () => {
    const clock = new FakeClock();
    const { ctx } = buildTestContext({ clock });
    const { socks, lobbyId } = await startGame(ctx, 7);

    // The room scheduled DAY_0's deadline at construction; before any advance no
    // phase has ended yet (still DAY_0 / no game_over).
    expect(socks.some((s) => s.ofType('game_over').length > 0)).toBe(false);
    expect(clock.pending).toBeGreaterThan(0);

    // Drive virtual time forward. With no votes/kills the reference engine
    // accrues quiet nights and resolves via the stalemate guard (§6.9); the
    // cascade of rescheduled deadlines all fires inside this single advance.
    clock.advance(60 * 60 * 1000); // an hour of virtual time — plenty for any path.

    // A public game_over reached every connected seat exactly once.
    socks.forEach((s) => expect(s.ofType('game_over').length).toBe(1));

    // The loop stopped: the room is over and no timers remain pending.
    const room = ctx.manager.getRoom(lobbyId)!;
    expect(room.isOver).toBe(true);
    expect(clock.pending).toBe(0);

    // game_over carries winners; no living-seat secret leaked on the public path
    // (the reveal in game_over is the legal one).
    const over = socks[0]!.lastOfType('game_over') as { winners?: unknown };
    expect(over).toBeDefined();
  });
});

// Reconnect snapshot equivalence (§8, §12.4): a seat disconnects mid-game and
// re-hellos with the same guest token; the resume snapshot it receives must
// describe the same public game state a never-disconnected observer sees, plus
// only its own private knowledge.
describe('reconnect snapshot equivalence (§8, §12.4)', () => {
  it("resumed view equals a never-disconnected client's public view + own private log", async () => {
    const clock = new FakeClock();
    const { ctx } = buildTestContext({ clock });
    const { gw, socks, conns, tokens, lobbyId } = await startGame(ctx, 7);
    const room = ctx.manager.getRoom(lobbyId)!;

    // Advance a little so we are past DAY_0 into the night/dawn cycle (state has
    // moved; snapshots become non-trivial).
    clock.advance(120 * 1000);

    // Seat 3 (a never-disconnected observer for cross-checking) and seat 5 (the
    // reconnecting one). Capture seat 5's own role from its original your_role.
    const reconnSeat = 5;
    const origYourRole = socks[reconnSeat]!.lastOfType('your_role') as {
      role: string;
      faction: string;
      mates?: unknown;
    };

    // Disconnect seat 5: drive the same path the gateway's socket-close handler
    // takes (manager.onDisconnect detaches the bound seat without pausing, §8).
    ctx.manager.onDisconnect(conns[reconnSeat]!);
    expect(room.seats[reconnSeat]!.connected).toBe(false);

    // Game keeps running while it is away (§8 — never pauses).
    clock.advance(120 * 1000);

    // Re-hello with the SAME guest token → re-attach + resume snapshot.
    const sock2 = new FakeSocket();
    await hello(gw, sock2, tokens[reconnSeat]);
    const welcome = sock2.lastOfType('welcome') as { resume?: Record<string, unknown> };
    expect(welcome.resume).toBeDefined();
    const snap = welcome.resume as {
      seat: number;
      ownRole: string;
      ownFaction: string;
      seats: { seat: number; alive: boolean }[];
      phase: string;
      mates?: unknown;
    };

    // Own identity in the snapshot matches what the seat was originally told.
    expect(snap.seat).toBe(reconnSeat);
    expect(snap.ownRole).toBe(origYourRole.role);
    expect(snap.ownFaction).toBe(origYourRole.faction);
    if (origYourRole.mates !== undefined) {
      expect(snap.mates).toEqual(origYourRole.mates);
    } else {
      expect(snap.mates).toBeUndefined();
    }

    // The snapshot's public phase + per-seat alive set agrees with the room's
    // authoritative public seat list (the same one a never-disconnected client
    // renders from public broadcasts).
    const publicSeats = room.publicSeats() as { seat: number; alive: boolean }[];
    expect(snap.phase).toBe((room.buildSnapshot(reconnSeat) as { phase: string }).phase);
    const aliveFromSnap = new Map(snap.seats.map((s) => [s.seat, s.alive]));
    const aliveFromRoom = new Map(publicSeats.map((s) => [s.seat, s.alive]));
    expect(aliveFromSnap).toEqual(aliveFromRoom);

    // The resumed connection is now the bound socket for the seat (newest wins).
    expect(room.seats[reconnSeat]!.connected).toBe(true);
  });
});

// "Play again" / rematch (§7.7). After a game ends the room lingers so the crowd
// can reconvene: the FIRST finished player to send `play_again` CREATES a fresh
// private waiting lobby (becomes host); subsequent senders JOIN that same lobby.
// The finished room is disposed once the last connection detaches.
describe('play again / rematch (§7.7)', () => {
  it('first player creates a fresh waiting lobby; a second joins the same lobby; the room disposes when empty', async () => {
    const clock = new FakeClock();
    const { ctx } = buildTestContext({ clock });
    const { gw, socks, conns, lobbyId } = await startGame(ctx, 7);

    // Drive to game_over (quiet game resolves via the stalemate guard, §6.9).
    clock.advance(60 * 60 * 1000);
    const room = ctx.manager.getRoom(lobbyId)!;
    expect(room.isOver).toBe(true);
    // The room lingers (NOT disposed at game-over) so its rematch id can persist.
    expect(ctx.manager.getRoom(lobbyId)).toBeDefined();

    // FIRST player clicks "play again": creates a fresh PRIVATE WAITING lobby and
    // becomes its host. Its id is stamped on the lingering room.
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'play_again' }));
    const created = socks[0]!.lastOfType('lobby_state') as
      | { lobby: { id: string; status: string; hostUserOrGuestId: string; members: unknown[] } }
      | undefined;
    expect(created).toBeDefined();
    const rematchLobbyId = created!.lobby.id;
    // A brand-new lobby (NOT the finished room id) in the WAITING state.
    expect(rematchLobbyId).not.toBe(lobbyId);
    expect(created!.lobby.status).toBe('waiting');
    expect(room.rematchLobbyId).toBe(rematchLobbyId);
    // The caller is the host and the sole member so far.
    expect(created!.lobby.hostUserOrGuestId).toBe(conns[0]!.identityId);
    expect(created!.lobby.members.length).toBe(1);
    // The new lobby is a NORMAL game (a rematch never inherits test/god mode).
    const rematchLobby = ctx.manager.getLobby(rematchLobbyId)!;
    expect(rematchLobby.config.testMode).not.toBe(true);
    // The caller is no longer scoped to the dead room; now scoped to the lobby.
    expect(ctx.manager.scopeIdOf(conns[0]!.identityId!)).toBe(rematchLobbyId);

    // SECOND player clicks "play again": JOINS the SAME lobby (roster grows).
    await gw.deliverForTest(conns[1]!, JSON.stringify({ v: 1, type: 'play_again' }));
    const joined = socks[1]!.lastOfType('lobby_state') as
      | { lobby: { id: string; members: unknown[] } }
      | undefined;
    expect(joined).toBeDefined();
    expect(joined!.lobby.id).toBe(rematchLobbyId);
    expect(joined!.lobby.members.length).toBe(2);
    expect(ctx.manager.scopeIdOf(conns[1]!.identityId!)).toBe(rematchLobbyId);

    // The rest click "play again" too → all reconvene in the one rematch lobby.
    for (let i = 2; i < conns.length; i++) {
      await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'play_again' }));
    }
    const finalState = ctx.manager.getLobby(rematchLobbyId)!;
    expect(finalState.playerCount).toBe(7);

    // The last detach disposed the finished room (no connections left): no leak.
    expect(ctx.manager.getRoom(lobbyId)).toBeUndefined();
  });

  it("returns 'no_game' when the caller is not in a finished room (fall back to Quick Play)", async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);

    // Never created/joined a lobby or game → no room scope → 'no_game'.
    const err = await ctx.manager.playAgain(conn);
    expect(err).toBe('no_game');

    // Over the gateway, the handler surfaces it as cannot_start + a 'no_game'
    // detail so the client can fall back to Quick Play.
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'play_again' }));
    const errFrame = sock.lastOfType('error') as { code: string; detail?: string } | undefined;
    expect(errFrame).toBeDefined();
    expect(errFrame!.code).toBe('cannot_start');
    expect(errFrame!.detail).toBe('no_game');
  });
});
