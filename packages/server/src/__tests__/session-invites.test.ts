import { describe, expect, it } from 'vitest';
import { safeParseServerMessage } from '@nocturne/shared';
import { Gateway } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';

describe('browser session and private invites', () => {
  it('issues a private guest token and resumes that identity after disconnect', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const first = new FakeSocket();
    const firstConn = gw.acceptForTest(first);
    await gw.deliverForTest(firstConn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
    const welcome = first.lastOfType('welcome')!;
    expect(safeParseServerMessage(welcome).success).toBe(true);
    expect(welcome['token']).toBeTypeOf('string');
    expect(welcome['token']).not.toBe(welcome['guestId']);
    const other = new FakeSocket();
    const otherConn = gw.acceptForTest(other);
    await gw.deliverForTest(otherConn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
    expect(JSON.stringify(other.sent)).not.toContain(welcome['token']);
    first.close();
    const second = new FakeSocket();
    const secondConn = gw.acceptForTest(second);
    await gw.deliverForTest(
      secondConn,
      JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, token: welcome['token'] }),
    );
    expect(second.lastOfType('welcome')?.['guestId']).toBe(welcome['guestId']);
    expect(second.lastOfType('welcome')?.['token']).toBeUndefined();
  });

  it('lets another browser join using the actual invite shown in the lobby DTO', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const host = new FakeSocket();
    const hostConn = gw.acceptForTest(host);
    await gw.deliverForTest(hostConn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
    await gw.deliverForTest(
      hostConn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'Invite regression',
        visibility: 'private',
        setupId: 'classic-nocturne',
      }),
    );
    const frame = safeParseServerMessage(host.lastOfType('lobby_state'));
    expect(frame.success).toBe(true);
    if (!frame.success || frame.data.type !== 'lobby_state') throw new Error('missing lobby');
    expect(frame.data.lobby.inviteCode).toHaveLength(6);
    expect(frame.data.lobby.inviteCode).not.toBe(frame.data.lobby.id);
    const friend = new FakeSocket();
    const friendConn = gw.acceptForTest(friend);
    await gw.deliverForTest(
      friendConn,
      JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }),
    );
    await gw.deliverForTest(
      friendConn,
      JSON.stringify({ v: 1, type: 'join_lobby', inviteCode: frame.data.lobby.inviteCode }),
    );
    expect(ctx.manager.lobbyOf(friendConn)?.id).toBe(frame.data.lobby.id);
    expect(friend.ofType('error')).toHaveLength(0);
  });

  it('echoes ping identity separately from the authoritative server clock', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const socket = new FakeSocket();
    const conn = gw.acceptForTest(socket);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
    const before = Date.now();
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'ping', t: 123 }));
    const pong = socket.lastOfType('pong')!;
    expect(pong['t']).toBe(123);
    expect(pong['serverTime']).toBeGreaterThanOrEqual(before);
    expect(safeParseServerMessage(pong).success).toBe(true);
  });
});
