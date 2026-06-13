/**
 * Lobby flow unit tests (BUILD_SPEC §7) + duplicate-connection takeover (§8).
 */

import { describe, it, expect } from 'vitest';
import { Gateway } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';
import { type Connection } from '../ws/connection.js';
import { resolveConfig } from '../lobby/lobby.js';

async function hello(gw: Gateway, sock: FakeSocket): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  // route through the gateway pipeline so identity binding (newest-wins) happens
  await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
  return conn;
}

describe('lobby flow (§7)', () => {
  it('create → join private by invite code → lobby_state broadcast', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);

    const hostSock = new FakeSocket();
    const hostConn = await hello(gw, hostSock);
    await gw.deliverForTest(
      hostConn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'Speakeasy',
        visibility: 'private',
        setupId: 'classic-nocturne',
      }),
    );
    const lobbyState = hostSock.lastOfType('lobby_state');
    expect(lobbyState).toBeTruthy();
    const lobby = (lobbyState as { lobby: { id: string; status: string } }).lobby;
    expect(lobby.status).toBe('waiting');
    const code = ctx.manager.getLobby(lobby.id)!.inviteCode!;
    expect(code).toHaveLength(6);

    const joinerSock = new FakeSocket();
    const joinerConn = await hello(gw, joinerSock);
    await gw.deliverForTest(
      joinerConn,
      JSON.stringify({ v: 1, type: 'join_lobby', inviteCode: code }),
    );
    const joinState = joinerSock.lastOfType('lobby_state') as { lobby: { members: unknown[] } };
    expect(joinState.lobby.members.length).toBe(2);
  });

  it('guest cannot create a public lobby (§7.1)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'Public',
        visibility: 'public',
        setupId: 'classic-nocturne',
      }),
    );
    expect(sock.lastOfType('error')?.code).toBe('forbidden');
  });

  it('host migrates to longest-seated on host leave (§7.4)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const a = await hello(gw, new FakeSocket());
    await gw.deliverForTest(
      a,
      JSON.stringify({ v: 1, type: 'create_lobby', name: 'L', visibility: 'private', setupId: 'classic-nocturne' }),
    );
    const lobby = ctx.manager.lobbyOf(a)!;
    const b = await hello(gw, new FakeSocket());
    await gw.deliverForTest(b, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId: lobby.id }));
    expect(lobby.hostId).toBe(a.identityId);
    ctx.manager.leaveLobby(a);
    expect(lobby.hostId).toBe(b.identityId);
  });

  it('start_game requires >= 7 players (§7.4)', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const host = await hello(gw, new FakeSocket());
    await gw.deliverForTest(
      host,
      JSON.stringify({ v: 1, type: 'create_lobby', name: 'L', visibility: 'private', setupId: 'classic-nocturne' }),
    );
    const startSock = host.socket as FakeSocket;
    await gw.deliverForTest(host, JSON.stringify({ v: 1, type: 'start_game' }));
    expect(startSock.lastOfType('error')?.code).toBe('cannot_start');
  });

  it('resolveConfig: public lobby defaults deadSeeAll=false (§5)', () => {
    expect(resolveConfig('public', undefined).deadSeeAll).toBe(false);
    expect(resolveConfig('private', undefined).deadSeeAll).toBe(true);
  });
});

describe('duplicate-connection takeover (§8)', () => {
  it('newest connection for an identity supersedes and closes the old socket', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);

    // First, create a guest and capture its token by issuing one via identity.
    const guest = ctx.identity.createGuest();
    const oldSock = new FakeSocket();
    const oldConn = gw.acceptForTest(oldSock);
    await gw.deliverForTest(
      oldConn,
      JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, token: guest.token }),
    );
    expect(oldSock.ofType('welcome').length).toBe(1);

    // Reconnect with the same token on a new socket; old must be closed.
    const newSock = new FakeSocket();
    const newConn = gw.acceptForTest(newSock);
    await gw.deliverForTest(
      newConn,
      JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, token: guest.token }),
    );
    expect(newSock.ofType('welcome').length).toBe(1);
    expect(oldSock.closed).toBeTruthy();
    expect(oldSock.closed?.code).toBe(4000);
  });
});
