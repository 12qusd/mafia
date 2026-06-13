/**
 * LLM-driven bot policy (BUILD_SPEC §12.2 extension — NOCTURNE test mode).
 *
 * Drives a bot from an LLM over an OpenAI-compatible chat-completions API
 * (`POST {base}/chat/completions`) OR Ollama native (`POST {base}/api/chat`),
 * auto-detected from the base URL / `kind` config. The bot composes a compact
 * prompt from ONLY its entitled {@link BotView} and asks for a JSON decision.
 *
 * Hard safety rules (the game must NEVER block or stall on the LLM):
 *   - STRICT output handling: extract the first JSON object, clamp/validate
 *     every field against legal moves; on ANY failure or timeout fall back to
 *     the scripted random-legal policy for that decision.
 *   - At most one LLM call per bot per phase for night actions/votes; chat at
 *     most every ~20s per bot.
 *   - Calls are fire-and-forget with the scripted fallback already queued at the
 *     phase deadline minus a grace window.
 *
 * Tuned for DUMB/FAST models: temperature ~0.8, max_tokens ≤120, tiny system
 * prompt.
 */

import { type BotClient, type BotView } from './client.js';
import { BotPolicy, type PolicyOptions } from './policy.js';
import { type ServerMessage, type ClientMessage, type SeatId } from './protocol.js';

export type LlmKind = 'openai' | 'ollama';

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Force a transport kind; otherwise auto-detected from baseUrl. */
  kind?: LlmKind;
  timeoutMs?: number;
  /** Optional shared concurrency limiter (server-wide LLM_MAX_CONCURRENCY). */
  gate?: ConcurrencyGate;
  /** Injectable fetch (tests mock this). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Min ms between chat lines from this bot. */
  chatCooldownMs?: number;
  /** Clock seam (tests pass a fake). */
  now?: () => number;
}

/** The parsed, phase-appropriate decision an LLM returns. */
export interface LlmDecision {
  say?: string;
  vote?: SeatId | 'skip' | null;
  verdict?: 'guilty' | 'innocent' | 'abstain';
  target?: SeatId | null;
}

/** A tiny FIFO concurrency limiter so many bots don't stampede the LLM. */
export class ConcurrencyGate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Auto-detect transport kind from a base URL (Ollama native paths vs OpenAI). */
export function detectLlmKind(baseUrl: string): LlmKind {
  // Ollama native API lives at /api/*; an OpenAI-compatible base ends in /v1.
  if (/\/api\/?$/.test(baseUrl) || /:11434(\/|$)/.test(baseUrl)) return 'ollama';
  return 'openai';
}

/**
 * Extract the first balanced JSON object from arbitrary model text and validate
 * it into an {@link LlmDecision}. Returns null on any failure (caller falls
 * back to the scripted policy).
 */
export function parseLlmDecision(text: string, view: BotView): LlmDecision | null {
  const obj = extractFirstJsonObject(text);
  if (!obj) return null;
  const out: LlmDecision = {};
  const living = view.alive;

  if (typeof obj.say === 'string') {
    const s = obj.say.trim().slice(0, 200);
    if (s) out.say = s;
  }

  if ('vote' in obj) {
    const vv = obj.vote;
    if (vv === 'skip') out.vote = 'skip';
    else if (vv === null) out.vote = null;
    else if (typeof vv === 'number' && living.has(vv) && vv !== view.seat) out.vote = vv;
    // illegal vote target → omit (fallback decides)
  }

  if (typeof obj.verdict === 'string') {
    if (obj.verdict === 'guilty' || obj.verdict === 'innocent' || obj.verdict === 'abstain') {
      out.verdict = obj.verdict;
    }
  }

  if ('target' in obj) {
    const tv = obj.target;
    if (tv === null) out.target = null;
    else if (typeof tv === 'number' && living.has(tv)) out.target = tv;
  }

  return out;
}

/** Find and parse the first `{...}` object in a string. */
function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * An LLM policy bound to one BotClient. It delegates legality and fallback to a
 * wrapped scripted {@link BotPolicy}: any LLM failure, timeout, or illegal field
 * leaves the scripted decision in place.
 */
export class LlmPolicy {
  private readonly fallback: BotPolicy;
  private readonly cfg: Required<Omit<LlmConfig, 'apiKey' | 'gate' | 'fetchImpl' | 'kind'>> &
    Pick<LlmConfig, 'apiKey' | 'gate' | 'fetchImpl' | 'kind'>;
  private readonly kind: LlmKind;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** Phase we already issued an LLM action call for (one per phase). */
  private lastLlmActionPhase: string | null = null;
  private lastLlmActionDay = -1;
  private lastChatAt = 0;

  constructor(
    private readonly bot: BotClient,
    llm: LlmConfig,
    policyOpts: PolicyOptions,
  ) {
    this.fallback = new BotPolicy(bot, policyOpts);
    this.kind = llm.kind ?? detectLlmKind(llm.baseUrl);
    this.fetchImpl = llm.fetchImpl ?? fetch;
    this.now = llm.now ?? Date.now;
    this.cfg = {
      baseUrl: llm.baseUrl.replace(/\/+$/, ''),
      model: llm.model,
      timeoutMs: llm.timeoutMs ?? 8000,
      chatCooldownMs: llm.chatCooldownMs ?? 20000,
      now: this.now,
      ...(llm.apiKey ? { apiKey: llm.apiKey } : {}),
      ...(llm.gate ? { gate: llm.gate } : {}),
      ...(llm.fetchImpl ? { fetchImpl: llm.fetchImpl } : {}),
      ...(llm.kind ? { kind: llm.kind } : {}),
    };
  }

  /** React to one inbound frame: run scripted baseline, then maybe ask the LLM. */
  onFrame(msg: ServerMessage): void {
    // Scripted baseline ALWAYS runs first so a legal action is queued even if the
    // LLM never answers (never block the game).
    this.fallback.onFrame(msg);
    if (this.bot.view.over || !this.bot.view.selfAlive) return;
    if (msg.type !== 'phase_change') return;

    const phase = this.bot.view.phase;
    if (!this.isDecisionPhase(phase)) return;
    // One LLM action per (phase, day).
    if (this.lastLlmActionPhase === phase && this.lastLlmActionDay === this.bot.view.dayNumber) return;
    this.lastLlmActionPhase = phase ?? null;
    this.lastLlmActionDay = this.bot.view.dayNumber;
    void this.askAndAct(phase as string);
  }

  /** Periodic tick: delegate to scripted (the LLM acts on phase entry only). */
  tick(): void {
    this.fallback.tick();
  }

  private isDecisionPhase(phase: string | null): boolean {
    return (
      phase === 'NIGHT' ||
      phase === 'DAY_DISCUSSION' ||
      phase === 'DAY_VOTING' ||
      phase === 'TRIAL_DEFENSE' ||
      phase === 'TRIAL_JUDGMENT'
    );
  }

  /** Fire-and-forget: ask the LLM and apply its (validated) decision. */
  private async askAndAct(phase: string): Promise<void> {
    const release = this.cfg.gate ? await this.cfg.gate.acquire() : null;
    try {
      const text = await this.callLlm(this.buildPrompt(phase));
      if (text === null) return; // timeout/error → scripted baseline stands
      const decision = parseLlmDecision(text, this.bot.view);
      if (!decision) return;
      this.applyDecision(phase, decision);
    } catch {
      // Any failure → scripted baseline stands.
    } finally {
      if (release) release();
    }
  }

  /** Apply a validated decision via the bot's protocol-checked send path. */
  private applyDecision(phase: string, d: LlmDecision): void {
    if (this.bot.view.over || !this.bot.view.selfAlive) return;
    // Chat (rate-limited per bot).
    if (d.say && this.now() - this.lastChatAt >= this.cfg.chatCooldownMs) {
      const channel = phase === 'NIGHT' && this.bot.view.faction === 'MAFIA' ? 'mafia' : 'day';
      this.lastChatAt = this.now();
      this.bot.send({ v: 1, type: 'chat', channel, text: d.say } as ClientMessage);
    }
    if (phase === 'DAY_VOTING' && d.vote !== undefined) {
      this.bot.send({ v: 1, type: 'vote', target: d.vote } as ClientMessage);
    }
    if (phase === 'TRIAL_JUDGMENT' && d.verdict && this.bot.view.trialAccused !== this.bot.view.seat) {
      this.bot.send({ v: 1, type: 'verdict', value: d.verdict } as ClientMessage);
    }
    if (phase === 'NIGHT' && d.target !== undefined) {
      const ability = this.bot.view.abilities.find((a) => a.timing === 'night')?.id;
      if (ability) {
        this.bot.send({ v: 1, type: 'night_action', ability, target: d.target } as ClientMessage);
      }
    }
  }

  /** Compose a compact prompt from ONLY the bot's entitled view. */
  private buildPrompt(phase: string): { system: string; user: string } {
    const v = this.bot.view;
    const living = [...v.alive].sort((a, b) => a - b);
    const tally = [...v.tallies.entries()].map(([s, w]) => `${s}:${w}`).join(', ') || 'none';
    const chat = v.recentChat
      .slice(-15)
      .map((c) => `${c.from === 'Jailor' ? 'Jailor' : 'seat ' + c.from}: ${c.text}`)
      .join('\n');
    const priv = v.privateResults
      .slice(-6)
      .map((p) => JSON.stringify(p))
      .join('; ');
    const mates = v.mates.length ? ` Mafia mates: seats ${v.mates.join(', ')}.` : '';

    const system =
      'You play a Mafia/Werewolf social-deduction game. Reply with ONE compact JSON object only, no prose. ' +
      'Keys (use only those relevant to the phase): say (string, optional short line), ' +
      'vote (seat number | "skip" | null), verdict ("guilty"|"innocent"|"abstain"), target (seat number | null). ' +
      'Only target living seats. Be decisive.';

    const user =
      `You are seat ${v.seat}, role ${v.role}, faction ${v.faction}.${mates}\n` +
      `Phase: ${phase}, day ${v.dayNumber}. Living seats: ${living.join(', ')}.\n` +
      `Vote tally: ${tally}.\n` +
      (v.trialAccused !== null ? `On trial: seat ${v.trialAccused}.\n` : '') +
      (priv ? `Your private results: ${priv}.\n` : '') +
      (chat ? `Recent chat:\n${chat}\n` : '') +
      this.taskFor(phase);

    return { system, user };
  }

  private taskFor(phase: string): string {
    switch (phase) {
      case 'NIGHT':
        return 'Choose your night target (or null). Optionally add a short mafia/day line in "say".';
      case 'DAY_DISCUSSION':
        return 'Say one short line to steer suspicion. Return {"say": "..."}.';
      case 'DAY_VOTING':
        return 'Vote: pick a seat to put on trial, or "skip", or null. Optionally "say".';
      case 'TRIAL_DEFENSE':
        return 'Argue briefly. Return {"say": "..."}.';
      case 'TRIAL_JUDGMENT':
        return 'Return your verdict: guilty, innocent, or abstain.';
      default:
        return 'Return {}.';
    }
  }

  /** Call the LLM with a timeout. Returns the assistant text, or null on failure. */
  private async callLlm(prompt: { system: string; user: string }): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const { url, body, headers } = this.requestFor(prompt);
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      return this.extractText(json);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private requestFor(prompt: { system: string; user: string }): {
    url: string;
    body: unknown;
    headers: Record<string, string>;
  } {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const messages = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    if (this.kind === 'ollama') {
      return {
        url: `${this.cfg.baseUrl}/api/chat`,
        headers,
        body: {
          model: this.cfg.model,
          messages,
          stream: false,
          options: { temperature: 0.8, num_predict: 120 },
        },
      };
    }
    return {
      url: `${this.cfg.baseUrl}/chat/completions`,
      headers,
      body: {
        model: this.cfg.model,
        messages,
        temperature: 0.8,
        max_tokens: 120,
      },
    };
  }

  private extractText(json: unknown): string | null {
    if (!json || typeof json !== 'object') return null;
    const j = json as Record<string, unknown>;
    // OpenAI-compatible: choices[0].message.content
    const choices = j.choices;
    if (Array.isArray(choices) && choices[0]) {
      const msg = (choices[0] as Record<string, unknown>).message as
        | Record<string, unknown>
        | undefined;
      if (msg && typeof msg.content === 'string') return msg.content;
    }
    // Ollama native: message.content
    const message = j.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') return message.content;
    return null;
  }
}
