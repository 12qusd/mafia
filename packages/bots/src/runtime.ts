/**
 * @nocturne/bots/runtime — the STANDALONE bot runtime (BUILD_SPEC §12.2).
 *
 * This entry deliberately exports ONLY the pieces that are safe to import from
 * the SERVER (BotClient, BotPolicy, LlmPolicy, protocol, rng). It must NEVER
 * transitively import the in-process server harness (`server-harness.ts`), which
 * depends on `@nocturne/server` and would create a dependency cycle
 * (server → bots → server).
 *
 * The package's main entry (`index.ts`) re-exports this PLUS the harness/sims for
 * the CLIs and tests. The server imports `@nocturne/bots/runtime` only.
 */

export { BotClient, type BotView, type BotClientOptions, type CapturedFrame } from './client.js';
export { BotPolicy, type PolicyOptions } from './policy.js';
export {
  LlmPolicy,
  ConcurrencyGate,
  type LlmConfig,
  type LlmDecision,
  parseLlmDecision,
  detectLlmKind,
} from './llm-policy.js';
export { mulberry32, hashSeed } from './rng.js';
export {
  PROTOCOL_VERSION,
  parseServerMessage,
  serializeClientMessage,
  type ServerMessage,
  type ClientMessage,
  type SeatId,
} from './protocol.js';
