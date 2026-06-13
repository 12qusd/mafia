/**
 * TEST-MODE in-process bot backfill (BUILD_SPEC §12.2 extension).
 *
 * Spawns/despawns bots that connect over REAL loopback WebSockets to THIS same
 * server and join a test lobby via its invite code as guests. They behave
 * exactly like external clients — there are no engine shortcuts. The host adds
 * them with `test_control add_bot` (pre-game) and they auto-clean up on game
 * end / lobby close / server drain.
 *
 * Dependency hygiene (the cycle break): the package graph is one-directional —
 * `@nocturne/bots` depends on `@nocturne/server` (for its in-process harness),
 * NEVER the reverse. So this module does NOT add a static package dependency on
 * `@nocturne/bots`. It reaches the standalone bot runtime via a lazy dynamic
 * `import('@nocturne/bots/runtime')` (resolved at runtime through the workspace),
 * and imports ONLY client/policy/llm — never the harness. A local type shim
 * keeps the call sites typed without a build-time edge.
 */

import { log } from '../log.js';

// --- Local structural type shim for @nocturne/bots/runtime -----------------
// Mirrors only what the BotManager uses. The real implementation is loaded
// lazily at runtime; this avoids a build-time server→bots dependency edge.

interface BotClientLike {
  connect(): Promise<void>;
  send(msg: unknown): void;
  close(): void;
  policyDrive: ((msg: unknown) => void) | null;
}
interface PolicyLike {
  onFrame(msg: unknown): void;
  tick(): void;
}
interface BotRuntimeModule {
  BotClient: new (opts: { url: string; name: string; token?: string }) => BotClientLike;
  BotPolicy: new (bot: BotClientLike, opts: { seed: string }) => PolicyLike;
  LlmPolicy: new (
    bot: BotClientLike,
    llm: Record<string, unknown>,
    opts: { seed: string },
  ) => PolicyLike;
  ConcurrencyGate: new (max: number) => unknown;
}

let runtimePromise: Promise<BotRuntimeModule> | null = null;
function loadBotRuntime(): Promise<BotRuntimeModule> {
  if (!runtimePromise) {
    // Indirect specifier so tsc/NodeNext does not try to type-resolve the
    // bots package (which would re-introduce the cycle). Resolved at runtime.
    const spec = '@nocturne/bots/runtime';
    runtimePromise = import(spec) as Promise<BotRuntimeModule>;
  }
  return runtimePromise;
}

/** LLM configuration the BotManager forwards to LlmPolicy (env-derived). */
export interface BotLlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
}

export interface BotManagerOptions {
  /** ws://host:port/ws of this running server (resolved after listen). */
  wsUrl: () => string | null;
  /** LLM config (env-derived), or null if LLM_BASE_URL is unset. */
  llm: BotLlmConfig | null;
  /** Inform the host (god audience) of a warning, e.g. LLM unavailable. */
  warn?: (lobbyId: string, detail: string) => void;
}

interface BotEntry {
  id: number;
  name: string;
  client: BotClientLike;
  ticker: ReturnType<typeof setInterval> | null;
}

/** Original noir bot handles (distinct, §2.1.2 voice). */
const BOT_NAMES = [
  'Slick Eddie',
  'Knuckles Malone',
  'Babyface Nolan',
  'Doc Sullivan',
  'Whisper Kane',
  'Lefty Romano',
  'Big Sal',
  'Ace Delgado',
  'Cricket Doyle',
  'Bones Carver',
  'Snake Vitelli',
  'Pinky Lombard',
  'Greasy Pete',
  'Iron Mae',
  'Cousin Vito',
];

export class BotManager {
  private readonly perLobby = new Map<string, BotEntry[]>();
  private gate: unknown = null;
  private nextId = 1;

  constructor(private readonly opts: BotManagerOptions) {}

  /** Number of bots currently attached to a lobby/room. */
  count(lobbyId: string): number {
    return this.perLobby.get(lobbyId)?.length ?? 0;
  }

  /**
   * Add `count` bots to the test lobby identified by `inviteCode`. Bots connect,
   * hello as fresh guests, then join by invite code. `policy` selects the driver.
   * Returns the number successfully spawned (best-effort; never throws).
   */
  async addBots(
    lobbyId: string,
    inviteCode: string,
    count: number,
    policy: 'scripted' | 'llm',
  ): Promise<number> {
    const wsUrl = this.opts.wsUrl();
    if (!wsUrl) return 0;
    let runtime: BotRuntimeModule;
    try {
      runtime = await loadBotRuntime();
    } catch (err) {
      log.warn('bot runtime unavailable', { err: String(err) });
      return 0;
    }
    const useLlm = policy === 'llm' && this.opts.llm !== null;
    if (policy === 'llm' && !this.opts.llm) {
      this.opts.warn?.(lobbyId, 'LLM_BASE_URL not configured; bots fall back to scripted policy');
    }
    if (useLlm && !this.gate) {
      const max = this.opts.llm?.maxConcurrency ?? 2;
      this.gate = new runtime.ConcurrencyGate(max);
    }
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const id = this.nextId++;
      const name = `Bot · ${BOT_NAMES[(id - 1) % BOT_NAMES.length]}`;
      try {
        const client = new runtime.BotClient({ url: wsUrl, name });
        await client.connect();
        client.send({ v: 1, type: 'join_lobby', inviteCode });
        const driver: PolicyLike = useLlm
          ? new runtime.LlmPolicy(
              client,
              {
                baseUrl: this.opts.llm!.baseUrl,
                model: this.opts.llm!.model,
                ...(this.opts.llm!.apiKey ? { apiKey: this.opts.llm!.apiKey } : {}),
                ...(this.opts.llm!.timeoutMs ? { timeoutMs: this.opts.llm!.timeoutMs } : {}),
                ...(this.gate ? { gate: this.gate } : {}),
              },
              { seed: `bot:${id}:${inviteCode}` },
            )
          : new runtime.BotPolicy(client, { seed: `bot:${id}:${inviteCode}` });
        client.policyDrive = (msg: unknown) => driver.onFrame(msg);
        const ticker = setInterval(() => {
          try {
            driver.tick();
          } catch {
            /* a policy bug must never crash the server */
          }
        }, 2000);
        if (ticker.unref) ticker.unref();
        const arr = this.perLobby.get(lobbyId) ?? [];
        arr.push({ id, name, client, ticker });
        this.perLobby.set(lobbyId, arr);
        spawned++;
      } catch (err) {
        log.warn('failed to spawn bot', { lobbyId, err: String(err) });
      }
    }
    log.info('bots added', { lobbyId, requested: count, spawned, policy });
    return spawned;
  }

  /** Remove a single bot by spawn-order index, or all. Returns removed count. */
  removeBots(lobbyId: string, which: number | 'all'): number {
    const arr = this.perLobby.get(lobbyId);
    if (!arr || arr.length === 0) return 0;
    if (which === 'all') {
      const n = arr.length;
      for (const e of arr) this.disposeEntry(e);
      this.perLobby.delete(lobbyId);
      return n;
    }
    if (which < 0 || which >= arr.length) return 0;
    const [e] = arr.splice(which, 1);
    if (e) this.disposeEntry(e);
    if (arr.length === 0) this.perLobby.delete(lobbyId);
    return e ? 1 : 0;
  }

  /** Remove ALL bots for a lobby/room (game end / lobby close). */
  cleanup(lobbyId: string): void {
    this.removeBots(lobbyId, 'all');
  }

  /** Drain: disconnect every bot across every lobby (server shutdown, §13.4). */
  disposeAll(): void {
    for (const id of [...this.perLobby.keys()]) this.cleanup(id);
  }

  private disposeEntry(e: BotEntry): void {
    if (e.ticker) clearInterval(e.ticker);
    try {
      e.client.send({ v: 1, type: 'leave_lobby' });
    } catch {
      /* ignore */
    }
    e.client.close();
  }
}
