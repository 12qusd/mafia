/**
 * Custom setup builder + chaos-setup lobby resolution.
 *
 * The MemoryStore is guests-only, so the POST /api/setups/custom auth check
 * (non-guest) is exercised at the route level elsewhere; here we drive the store
 * round-trip and the lobby-resolution path directly with a seeded store entry.
 */

import { describe, it, expect } from 'vitest';
import { chaosSetup, validateSetup, CLASSIC_NOCTURNE, type GameSetup } from '@nocturne/shared';
import { Gateway } from '../ws/gateway.js';
import { buildTestContext, FakeSocket } from './helpers.js';
import type { Connection } from '../ws/connection.js';

async function hello(gw: Gateway, sock: FakeSocket): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1 }));
  return conn;
}

describe('custom setup store round-trip', () => {
  it('create → get → list → delete', async () => {
    const { store } = buildTestContext();
    const owner = 'user-1';

    const row = await store.createCustomSetup(owner, 'My Build', CLASSIC_NOCTURNE);
    expect(row.id.startsWith('custom:')).toBe(true);
    expect(row.ownerUserId).toBe(owner);
    expect(row.name).toBe('My Build');

    const got = await store.getCustomSetup(row.id);
    expect(got?.setup).toEqual(CLASSIC_NOCTURNE);

    const list = await store.listCustomSetups(owner);
    expect(list.map((r) => r.id)).toContain(row.id);

    // Other owners cannot delete it.
    expect(await store.deleteCustomSetup(row.id, 'user-2')).toBe(false);
    expect(await store.deleteCustomSetup(row.id, owner)).toBe(true);
    expect(await store.getCustomSetup(row.id)).toBeNull();
  });

  it('persisted custom setups validate', async () => {
    const { store } = buildTestContext();
    const row = await store.createCustomSetup('u', 'c', chaosSetup('store-seed'));
    const got = await store.getCustomSetup(row.id);
    expect(got).not.toBeNull();
    expect(validateSetup(got!.setup)).toEqual({ ok: true });
  });
});

describe('createLobby resolves custom & chaos setups', () => {
  async function create(
    gw: Gateway,
    conn: Connection,
    setupId: string,
  ): Promise<FakeSocket> {
    await gw.deliverForTest(
      conn,
      JSON.stringify({
        v: 1,
        type: 'create_lobby',
        name: 'Build',
        visibility: 'private',
        setupId,
      }),
    );
    return conn.socket as FakeSocket;
  }

  it('accepts a custom:-prefixed id seeded in the store', async () => {
    const { ctx, store } = buildTestContext();
    const gw = new Gateway(ctx);
    const conn = await hello(gw, new FakeSocket());
    // Seed a custom setup owned by the connecting identity.
    const row = await store.createCustomSetup(conn.identityId as string, 'Mine', CLASSIC_NOCTURNE);

    const sock = await create(gw, conn, row.id);
    expect(sock.lastOfType('error')).toBeUndefined();
    const lobby = ctx.manager.lobbyOf(conn)!;
    expect(lobby.setupId).toBe(row.id);
    expect(lobby.resolvedSetup.id).toBe(CLASSIC_NOCTURNE.id);
  });

  it('rejects an unknown custom: id', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const conn = await hello(gw, new FakeSocket());
    const sock = await create(gw, conn, 'custom:does-not-exist');
    expect(sock.lastOfType('error')?.code).toBe('unknown_setup');
  });

  it('accepts a chaos:-prefixed id and resolves a 7..15 setup', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const conn = await hello(gw, new FakeSocket());
    const sock = await create(gw, conn, 'chaos:test-seed');
    expect(sock.lastOfType('error')).toBeUndefined();
    const lobby = ctx.manager.lobbyOf(conn)!;
    expect(lobby.resolvedSetup.minPlayers).toBe(7);
    expect(lobby.resolvedSetup.maxPlayers).toBe(15);
    expect(validateSetup(lobby.resolvedSetup as GameSetup)).toEqual({ ok: true });
  });

  it('rejects a malformed custom setup before lobby creation', async () => {
    const { ctx, store } = buildTestContext();
    const gw = new Gateway(ctx);
    const conn = await hello(gw, new FakeSocket());
    // Persist a deliberately broken setup (wrong slot count) directly.
    const broken: GameSetup = {
      ...CLASSIC_NOCTURNE,
      slotsByPlayerCount: { '7': CLASSIC_NOCTURNE.slotsByPlayerCount['7']!.slice(0, 5) },
      minPlayers: 7,
      maxPlayers: 7,
    };
    const row = await store.createCustomSetup(conn.identityId as string, 'Broken', broken);
    const sock = await create(gw, conn, row.id);
    expect(sock.lastOfType('error')?.code).toBe('unknown_setup');
  });
});
