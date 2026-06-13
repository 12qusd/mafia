/**
 * Socket integration smoke test (BUILD_SPEC §12.2, §12.3).
 *
 * Proves the REAL WebSocket path: bots connect over loopback to the real
 * in-process server, a lobby is created and started, every seat gets exactly one
 * own role card, and a live leak sweep over the first few phases shows no secret
 * crossed to a non-entitled seat. A FULL socket game to game_over takes minutes
 * (fixed DAWN/EXECUTION + min DAY_VOTING; see DECISIONS.md), so this test is
 * bounded to the opening phases; bulk game completion + leak coverage runs on the
 * engine FAST path (leak.test.ts, `pnpm leakcheck`). The CLI `pnpm sim --mode
 * socket` plays full socket games to completion when wall-clock allows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInProcessServer, type RunningServer } from '../server-harness.js';
import { BotClient } from '../client.js';
import { BotPolicy } from '../policy.js';
import { auditGame, type AuditSeat } from '../leak.js';
import { FAST_TIMINGS } from '../timings.js';

let server: RunningServer;
beforeAll(async () => {
  server = await startInProcessServer();
});
afterAll(async () => {
  await server.shutdown();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await sleep(20);
}

describe('socket integration (§12.2)', () => {
  it('starts a real socket game; each seat gets one role; no secret leaks in the opening phases', async () => {
    const players = 7;
    const bots: BotClient[] = [];
    for (let i = 0; i < players; i++) {
      bots.push(new BotClient({ url: server.wsUrl, name: `s-${i}` }));
    }
    await bots[0]!.connect();
    for (let i = 1; i < players; i++) await bots[i]!.connect();
    const policies = bots.map((bot, i) => {
      const p = new BotPolicy(bot, { seed: `socket:${i}` });
      bot.setSeat(i);
      bot.policyDrive = (m) => p.onFrame(m);
      return p;
    });

    const host = bots[0]!;
    host.send({
      v: 1,
      type: 'create_lobby',
      name: 'socket',
      visibility: 'private',
      setupId: 'classic-nocturne',
      config: { timings: FAST_TIMINGS, whispersEnabled: true, deadSeeAll: true, lastWillsEnabled: true },
    });
    await waitFor(() => host.lobbyId !== null, 3000);
    for (let i = 1; i < players; i++) bots[i]!.send({ v: 1, type: 'join_lobby', lobbyId: host.lobbyId! });
    await waitFor(() => host.lobbyMembers.filter((m) => !m.isSpectator).length >= players, 3000);
    host.send({ v: 1, type: 'start_game' });
    await waitFor(() => bots.every((b) => b.view.role !== null), 3000);

    // Every seat got exactly one your_role.
    for (const b of bots) {
      expect(b.capture.filter((m) => m.type === 'your_role').length).toBe(1);
    }
    // At least 2 mafia (classic 7p = GF + Mafioso).
    const mafia = bots.filter((b) => b.view.faction === 'MAFIA');
    expect(mafia.length).toBeGreaterThanOrEqual(2);
    // Non-mafia bots carry no mates roster.
    for (const b of bots) {
      const yr = b.capture.find((m) => m.type === 'your_role') as { faction: string; mates?: unknown };
      if (yr.faction !== 'MAFIA') expect(yr.mates).toBeUndefined();
    }

    // Let the first night happen so mafia chat flows, then audit live captures.
    const ticker = setInterval(() => policies.forEach((p) => p.tick()), 200);
    await waitFor(() => host.view.phase === 'NIGHT', 20000);
    await sleep(1500);
    clearInterval(ticker);

    // Live leak audit on partial captures: ground truth from each bot's own role
    // (we know it because each bot legitimately holds its own).
    const auditSeats: AuditSeat[] = bots.map((b, i) => ({
      seat: i,
      role: b.view.role!,
      faction: b.view.faction!,
      frames: b.capture,
    }));
    const leaks = auditGame({ seats: auditSeats, spectators: [], deadSeeAll: true });
    expect(leaks).toEqual([]);

    for (const b of bots) b.close();
  }, 30000);
});
