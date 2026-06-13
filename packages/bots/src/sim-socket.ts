/**
 * Socket simulator: one full game over REAL loopback WebSockets (BUILD_SPEC §12.2,
 * §12.3).
 *
 * Spawns P bot clients against the in-process real server, has the host bot create
 * a private lobby with the fastest legal timings (§6.2 min bounds — there is no
 * injectable clock seam through LobbyManager, see DECISIONS.md), fills it,
 * starts the game, and drives the policies to game_over while capturing every
 * frame at every client for the leak auditor.
 *
 * Seat assignment: the server seats players in roster (= join) order, host first.
 * We therefore know each bot's seat by its join index and inject it via setSeat so
 * the policy can reason about "self".
 */

import { startInProcessServer, type RunningServer } from './server-harness.js';
import { BotClient } from './client.js';
import { BotPolicy } from './policy.js';
import { auditGame, type LeakViolation, type AuditSeat } from './leak.js';
import { type ServerMessage } from './protocol.js';
import { FAST_TIMINGS, type SimTimings } from './timings.js';

export interface SocketGameOptions {
  url: string;
  players: number;
  seed: string;
  setupId: string;
  /** Phase timings to request (defaults to the fastest legal set). */
  timings?: SimTimings;
  /** Hard wall-clock cap for one game (ms). */
  timeoutMs?: number;
  /** How often policies tick within a phase (ms). */
  tickMs?: number;
  /** Capture spectators too (one spectator bot) for spectator leak coverage. */
  withSpectator?: boolean;
}

export interface SocketGameResult {
  completed: boolean;
  durationMs: number;
  winners: string[];
  /** game_over allRoles for ground truth. */
  allRoles: { seat: number; role: string; faction: string; outcome: string }[];
  leaks: LeakViolation[];
  errorFrames: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Play one full game over real sockets; returns stats + leak audit. */
export async function playSocketGame(opts: SocketGameOptions): Promise<SocketGameResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const tickMs = opts.tickMs ?? 1_000;
  const timings = opts.timings ?? FAST_TIMINGS;

  const bots: BotClient[] = [];
  const policies: BotPolicy[] = [];
  let spectator: BotClient | null = null;
  let errorFrames = 0;

  try {
    // Spawn player bots; bind a policy to each.
    for (let i = 0; i < opts.players; i++) {
      const name = `bot-${i}`;
      const bot = new BotClient({
        url: opts.url,
        name,
        onFrame: (m: ServerMessage) => {
          if (m.type === 'error') errorFrames++;
        },
      });
      bots.push(bot);
    }
    // Connect host first, then the rest, to fix join (= seat) order.
    await bots[0]!.connect();
    for (let i = 1; i < bots.length; i++) await bots[i]!.connect();

    // Attach a policy AFTER connect so onFrame routing is in place. We rewire the
    // onFrame to also drive the policy (the client already captured everything).
    bots.forEach((bot, i) => {
      const policy = new BotPolicy(bot, { seed: `${opts.seed}:bot:${i}` });
      policies.push(policy);
      // The server seats players in join order (host first), so this bot's seat
      // id equals its connect index i. Inject it now so the policy can reason
      // about "self" from the very first phase_change (§12.2).
      bot.setSeat(i);
      bot.policyDrive = (m) => policy.onFrame(m);
    });

    // Optional spectator joins to assert §7.8 (spectators never see secrets).
    if (opts.withSpectator) {
      spectator = new BotClient({ url: opts.url, name: 'spectator' });
      await spectator.connect();
    }

    // Host creates a private lobby with the fastest legal timings.
    const host = bots[0]!;
    host.send({
      v: 1,
      type: 'create_lobby',
      name: 'sim',
      visibility: 'private',
      setupId: opts.setupId,
      config: {
        timings,
        whispersEnabled: true,
        deadSeeAll: true,
        lastWillsEnabled: true,
      },
    });
    // Wait for the lobby id.
    await waitFor(() => host.lobbyId !== null, 5_000);
    const lobbyId = host.lobbyId!;

    // Others join by lobby id (host is already in).
    for (let i = 1; i < bots.length; i++) {
      bots[i]!.send({ v: 1, type: 'join_lobby', lobbyId });
    }
    if (spectator) spectator.send({ v: 1, type: 'join_lobby', lobbyId, asSpectator: true });

    // Wait until the host sees all players in the lobby roster.
    await waitFor(
      () => host.lobbyMembers.filter((m) => !m.isSpectator).length >= opts.players,
      5_000,
    );

    // Start the game.
    host.send({ v: 1, type: 'start_game' });
    // Wait for role cards (every player gets one).
    await waitFor(() => bots.every((b) => b.view.role !== null), 5_000);

    // Drive policies via the per-frame hook (wired above); tick periodically so
    // bots can change night actions / follow tallies before deadlines.
    const deadline = t0 + timeoutMs;
    while (!host.view.over && Date.now() < deadline) {
      for (const p of policies) p.tick();
      await sleep(tickMs);
      if (bots.every((b) => b.view.over)) break;
    }

    const completed = host.view.over;
    const goFrame = lastOfType(host.capture, 'game_over') as
      | Extract<ServerMessage, { type: 'game_over' }>
      | undefined;
    const allRoles = goFrame ? goFrame.allRoles.map((r) => ({ ...r })) : [];
    const winners = goFrame ? [...goFrame.winners] : [];

    // Build the audit input from captures + ground truth.
    const auditSeats: AuditSeat[] = bots.map((b, i) => {
      const truth = allRoles.find((r) => r.seat === i);
      return {
        seat: i,
        role: truth?.role ?? b.view.role ?? 'CITIZEN',
        faction: truth?.faction ?? b.view.faction ?? 'TOWN',
        frames: b.capture,
      };
    });
    const leaks = completed
      ? auditGame({
          seats: auditSeats,
          spectators: spectator ? [{ frames: spectator.capture }] : [],
          deadSeeAll: true,
        })
      : [];

    return {
      completed,
      durationMs: Date.now() - t0,
      winners,
      allRoles,
      leaks,
      errorFrames,
    };
  } catch (err) {
    return {
      completed: false,
      durationMs: Date.now() - t0,
      winners: [],
      allRoles: [],
      leaks: [],
      errorFrames,
      error: String(err),
    };
  } finally {
    for (const b of bots) b.close();
    spectator?.close();
  }
}

export interface SocketSimSummary {
  games: number;
  completed: number;
  totalLeaks: number;
  totalErrorFrames: number;
  durations: number[];
  winBreakdown: Record<string, number>;
  errors: string[];
}

/** Run N socket games against one shared in-process server. */
export async function runSocketSim(opts: {
  games: number;
  players: number;
  seedBase: number;
  setupId: string;
  withSpectator?: boolean;
  timeoutMs?: number;
  server?: RunningServer;
}): Promise<{ summary: SocketSimSummary; server: RunningServer; ownsServer: boolean }> {
  const ownsServer = !opts.server;
  const server = opts.server ?? (await startInProcessServer());
  const summary: SocketSimSummary = {
    games: 0,
    completed: 0,
    totalLeaks: 0,
    totalErrorFrames: 0,
    durations: [],
    winBreakdown: {},
    errors: [],
  };

  for (let g = 0; g < opts.games; g++) {
    const res = await playSocketGame({
      url: server.wsUrl,
      players: opts.players,
      seed: `${opts.seedBase + g}`,
      setupId: opts.setupId,
      ...(opts.withSpectator ? { withSpectator: true } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
    summary.games++;
    summary.durations.push(res.durationMs);
    summary.totalErrorFrames += res.errorFrames;
    if (res.completed) {
      summary.completed++;
      const key = res.winners.length ? res.winners.sort().join('+') : 'none';
      summary.winBreakdown[key] = (summary.winBreakdown[key] ?? 0) + 1;
    }
    summary.totalLeaks += res.leaks.length;
    if (res.error) summary.errors.push(res.error);
    if (res.leaks.length) {
      summary.errors.push(
        `game ${g}: ${res.leaks.length} leak(s) — first: ${res.leaks[0]!.reason} (${res.leaks[0]!.frameType})`,
      );
    }
  }

  return { summary, server, ownsServer };
}

// --- small utilities --------------------------------------------------------

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred() && Date.now() < deadline) await sleep(20);
  if (!pred()) throw new Error('waitFor timed out');
}

function lastOfType(frames: ServerMessage[], type: string): ServerMessage | undefined {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i]!.type === type) return frames[i];
  return undefined;
}
