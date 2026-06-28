/**
 * In-game moderation + admin god-power handlers (BUILD_SPEC §11, goal 8).
 *
 * Drives the REAL gateway pipeline (`Gateway.acceptForTest` / `deliverForTest`)
 * over the NO_DB context so the `report_player` and `admin_action` handlers run
 * exactly as in production. The fallback engine is in use here (helpers wire it
 * in), so admin_kill/admin_stump are accepted as logged, replayable events even
 * though the simplified engine does not act on them — what we assert is the
 * server-side authz boundary + audit logging, which live in `manager.adminControl`.
 *
 * The Moderation service (report dedupe, sanction ladder, getActiveSanctions) is
 * also covered directly at the store/service layer — all NO_DB-implemented.
 */

import { describe, it, expect, vi } from 'vitest';
import { Gateway } from '../ws/gateway.js';
import { Moderation } from '../moderation/moderation.js';
import { MemoryStore } from '../db/memory-store.js';
import { buildTestContext, FakeSocket } from './helpers.js';
import type { GatewayContext } from '../ws/context.js';
import type { Connection } from '../ws/connection.js';

async function hello(gw: Gateway, sock: FakeSocket, token?: string): Promise<Connection> {
  const conn = gw.acceptForTest(sock);
  await gw.deliverForTest(
    conn,
    JSON.stringify({ v: 1, type: 'hello', protocolVersion: 1, ...(token ? { token } : {}) }),
  );
  return conn;
}

/** Seat `n` guests into a started classic-nocturne game over the real gateway. */
async function startGame(
  ctx: GatewayContext,
  n: number,
): Promise<{ gw: Gateway; socks: FakeSocket[]; conns: Connection[] }> {
  const gw = new Gateway(ctx);
  const socks: FakeSocket[] = [];
  const conns: Connection[] = [];
  for (let i = 0; i < n; i++) {
    const guest = ctx.identity.createGuest();
    const s = new FakeSocket();
    socks.push(s);
    conns.push(await hello(gw, s, guest.token));
  }
  await gw.deliverForTest(
    conns[0]!,
    JSON.stringify({
      v: 1,
      type: 'create_lobby',
      name: 'L',
      visibility: 'private',
      setupId: 'classic-nocturne',
    }),
  );
  const lobbyId = ctx.manager.lobbyOf(conns[0]!)!.id;
  for (let i = 1; i < n; i++) {
    await gw.deliverForTest(conns[i]!, JSON.stringify({ v: 1, type: 'join_lobby', lobbyId }));
  }
  await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'start_game' }));
  return { gw, socks, conns };
}

/** Promote a connection's identity to admin (the only mutation needed to test god-powers). */
function promoteToAdmin(conn: Connection): void {
  if (conn.identity) conn.identity = { ...conn.identity, isAdmin: true };
}

// --- admin_action authz boundary -------------------------------------------

describe('admin_action — authz gate', () => {
  it('a non-admin in a game gets error{forbidden}, no audit', async () => {
    const { ctx, store } = buildTestContext();
    const audit = vi.spyOn(store, 'logAdminAction');
    const { gw, socks, conns } = await startGame(ctx, 7);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'admin_action', action: 'force_phase' }));
    expect(socks[0]!.lastOfType('error')?.code).toBe('forbidden');
    expect(audit).not.toHaveBeenCalled();
  });

  it('an admin NOT in a game gets error{not_in_game}', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    promoteToAdmin(conn);
    await gw.deliverForTest(conn, JSON.stringify({ v: 1, type: 'admin_action', action: 'force_phase' }));
    expect(sock.lastOfType('error')?.code).toBe('not_in_game');
  });
});

// --- admin god-powers (audited) --------------------------------------------

describe('admin_action — god powers (admin, in-game)', () => {
  it('force_phase succeeds + is audited; no error frame', async () => {
    const { ctx, store } = buildTestContext();
    const audit = vi.spyOn(store, 'logAdminAction');
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'admin_action', action: 'force_phase' }));
    expect(socks[0]!.ofType('error')).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(
      conns[0]!.identityId,
      'admin_force_phase',
      expect.objectContaining({ room: expect.any(String) }),
    );
  });

  it('kill targets a seat + is audited', async () => {
    const { ctx, store } = buildTestContext();
    const audit = vi.spyOn(store, 'logAdminAction');
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'admin_action', action: 'kill', targetSeat: 3, reason: 'afk' }),
    );
    expect(socks[0]!.ofType('error')).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(
      conns[0]!.identityId,
      'admin_kill',
      expect.objectContaining({ seat: 3, reason: 'afk' }),
    );
  });

  it('kill without a targetSeat is illegal_target (no audit)', async () => {
    const { ctx, store } = buildTestContext();
    const audit = vi.spyOn(store, 'logAdminAction');
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(conns[0]!, JSON.stringify({ v: 1, type: 'admin_action', action: 'kill' }));
    expect(socks[0]!.lastOfType('error')?.code).toBe('illegal_target');
    expect(audit).not.toHaveBeenCalled();
  });

  it('stump targets a seat + is audited', async () => {
    const { ctx, store } = buildTestContext();
    const audit = vi.spyOn(store, 'logAdminAction');
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'admin_action', action: 'stump', targetSeat: 2 }),
    );
    expect(socks[0]!.ofType('error')).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(
      conns[0]!.identityId,
      'admin_stump',
      expect.objectContaining({ seat: 2 }),
    );
  });

  it('grant_points on a GUEST seat is illegal_target (accounts only)', async () => {
    // Every seat in the NO_DB game is a guest (`guest:<uuid>`), which the
    // point/ban god-powers refuse — a real authz/validation boundary.
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'admin_action', action: 'grant_points', targetSeat: 4, points: 50 }),
    );
    expect(socks[0]!.lastOfType('error')?.code).toBe('illegal_target');
  });

  it('temp_ban on a GUEST seat is illegal_target (accounts only)', async () => {
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    promoteToAdmin(conns[0]!);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'admin_action', action: 'temp_ban', targetSeat: 4 }),
    );
    expect(socks[0]!.lastOfType('error')?.code).toBe('illegal_target');
  });
});

// --- temp_ban on an ACCOUNT seat: sanction recorded + audited ---------------

describe('admin_action — temp_ban on an account seat', () => {
  it('records a temp_ban sanction reflected in getActiveSanctions + audits it', async () => {
    const { ctx, store } = buildTestContext();
    const { gw, conns } = await startGame(ctx, 7);
    const admin = conns[0]!;
    promoteToAdmin(admin);

    // Override seat 5 to map to a NON-guest (account) identity so the god-power's
    // guest guard is satisfied. We patch the room's seat→identity lookup for the
    // target seat only; everything downstream (applySanction/audit) is real.
    const room = ctx.manager.roomOf(admin)!;
    const ACCOUNT_ID = 'user-target-555';
    const origIdFor = room.identityForSeat.bind(room);
    vi.spyOn(room, 'identityForSeat').mockImplementation((seat) =>
      seat === 5 ? ACCOUNT_ID : origIdFor(seat),
    );
    const audit = vi.spyOn(store, 'logAdminAction');

    await gw.deliverForTest(
      admin,
      JSON.stringify({
        v: 1,
        type: 'admin_action',
        action: 'temp_ban',
        targetSeat: 5,
        durationMs: 3600_000,
        reason: 'toxic',
      }),
    );

    const active = await store.getActiveSanctions(ACCOUNT_ID);
    expect(active.banned).toBe(true);
    expect(active.banExpiresAt).toBeGreaterThan(Date.now());
    const sanctions = await store.listSanctions(ACCOUNT_ID);
    expect(sanctions).toHaveLength(1);
    expect(sanctions[0]!.type).toBe('temp_ban');
    expect(sanctions[0]!.issuedBy).toBe(admin.identityId);
    expect(audit).toHaveBeenCalledWith(
      admin.identityId,
      'admin_temp_ban',
      expect.objectContaining({ userId: ACCOUNT_ID, seat: 5 }),
    );
  });
});

// --- report_player handler --------------------------------------------------

describe('report_player handler', () => {
  it('files a report; a duplicate (same reporter/target/match) dedupes', async () => {
    const { ctx, store } = buildTestContext();
    const { gw, conns } = await startGame(ctx, 7);
    const reporter = conns[0]!;
    const targetId = ctx.manager.roomOf(reporter)!.identityForSeat(3)!;

    await gw.deliverForTest(
      reporter,
      JSON.stringify({ v: 1, type: 'report_player', seat: 3, category: 'harassment', comment: 'rude' }),
    );
    let reports = await store.listReports('open');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.targetUser).toBe(targetId);
    expect(reports[0]!.category).toBe('harassment');

    // A second identical report from the same reporter dedupes (no second row).
    await gw.deliverForTest(
      reporter,
      JSON.stringify({ v: 1, type: 'report_player', seat: 3, category: 'harassment', comment: 'again' }),
    );
    reports = await store.listReports('open');
    expect(reports).toHaveLength(1);
  });

  it('reporting a non-existent seat is illegal_target', async () => {
    const { ctx } = buildTestContext();
    const { gw, socks, conns } = await startGame(ctx, 7);
    socks[0]!.sent.length = 0;
    await gw.deliverForTest(
      conns[0]!,
      JSON.stringify({ v: 1, type: 'report_player', seat: 99, category: 'spam' }),
    );
    expect(socks[0]!.lastOfType('error')?.code).toBe('illegal_target');
  });

  it('report_player outside a game is not_in_game', async () => {
    const { ctx } = buildTestContext();
    const gw = new Gateway(ctx);
    const sock = new FakeSocket();
    const conn = await hello(gw, sock);
    await gw.deliverForTest(
      conn,
      JSON.stringify({ v: 1, type: 'report_player', seat: 0, category: 'spam' }),
    );
    expect(sock.lastOfType('error')?.code).toBe('not_in_game');
  });
});

// --- Moderation service: sanction ladder + dedupe at the store layer --------

describe('Moderation service (store layer)', () => {
  it('dedupes a report per (reporter, target, match)', async () => {
    const store = new MemoryStore();
    const mod = new Moderation(store);
    const base = {
      reporter: 'rep-1',
      targetUser: 'tgt-1',
      matchId: 'match-1',
      category: 'cheating' as const,
      comment: null,
      chatContext: [],
    };
    const first = await mod.report(base);
    expect(first.deduped).toBe(false);
    const second = await mod.report(base);
    expect(second.deduped).toBe(true);
    // A different match from the same reporter is NOT a dupe.
    const other = await mod.report({ ...base, matchId: 'match-2' });
    expect(other.deduped).toBe(false);
    expect(await store.listReports('open')).toHaveLength(2);
  });

  it('mute is reflected in getActiveSanctions + audited', async () => {
    const store = new MemoryStore();
    const mod = new Moderation(store);
    const audit = vi.spyOn(store, 'logAdminAction');
    await mod.applySanction({
      userId: 'muted-1',
      type: 'mute',
      reason: 'spam',
      reportId: null,
      issuedBy: 'admin-1',
      durationMs: 60_000,
    });
    const active = await store.getActiveSanctions('muted-1');
    expect(active.muted).toBe(true);
    expect(active.muteExpiresAt).toBeGreaterThan(Date.now());
    expect(active.banned).toBe(false);
    expect(audit).toHaveBeenCalledWith(
      'admin-1',
      'apply_sanction',
      expect.objectContaining({ userId: 'muted-1', type: 'mute' }),
    );
  });

  it('perma_ban is a permanent ban (no expiry) in getActiveSanctions', async () => {
    const store = new MemoryStore();
    const mod = new Moderation(store);
    await mod.applySanction({
      userId: 'banned-1',
      type: 'perma_ban',
      reason: null,
      reportId: null,
      issuedBy: 'admin-1',
    });
    const active = await store.getActiveSanctions('banned-1');
    expect(active.banned).toBe(true);
    expect(active.banExpiresAt).toBeNull();
  });

  it('an EXPIRED temp_ban no longer counts as banned', async () => {
    const store = new MemoryStore();
    const mod = new Moderation(store);
    // Apply a temp_ban that has already lapsed (negative duration → past expiry).
    await mod.applySanction({
      userId: 'expired-1',
      type: 'temp_ban',
      reason: null,
      reportId: null,
      issuedBy: 'admin-1',
      durationMs: -1,
    });
    const active = await store.getActiveSanctions('expired-1');
    expect(active.banned).toBe(false);
  });

  it('mute cache: setMute then isMuted reflects suppression state', async () => {
    const store = new MemoryStore();
    const mod = new Moderation(store);
    await mod.loadMutes('muter-1');
    expect(mod.isMuted('muter-1', 'sender-1')).toBe(false);
    await mod.setMute('muter-1', 'sender-1', true);
    expect(mod.isMuted('muter-1', 'sender-1')).toBe(true);
    await mod.setMute('muter-1', 'sender-1', false);
    expect(mod.isMuted('muter-1', 'sender-1')).toBe(false);
  });
});
