/**
 * @nocturne/bots — headless protocol bots + simulator/leak/fuzz harness.
 *
 * Bots are the REFERENCE protocol client (BUILD_SPEC §4.1, §12.2): they connect
 * over real loopback WebSockets to the real server and speak the shared zod
 * protocol exactly like humans. This entry re-exports the public surface used by
 * the CLIs (`sim`, `dev:solo`, `leakcheck`) and the vitest suites.
 */

import { PROTOCOL_VERSION } from '@nocturne/shared';

export const BOTS_PROTOCOL_VERSION = PROTOCOL_VERSION;

export { BotClient, type BotView, type BotClientOptions } from './client.js';
export { BotPolicy, type PolicyOptions } from './policy.js';
export {
  LlmPolicy,
  ConcurrencyGate,
  parseLlmDecision,
  detectLlmKind,
  type LlmConfig,
  type LlmDecision,
  type LlmKind,
} from './llm-policy.js';
export { startInProcessServer, fetchGuestToken, type RunningServer } from './server-harness.js';
export {
  playSocketGame,
  runSocketSim,
  type SocketGameResult,
  type SocketSimSummary,
} from './sim-socket.js';
export { playEngineGame, type EngineGameResult } from './sim-engine.js';
export { auditGame, type LeakViolation, type AuditInput, type AuditSeat } from './leak.js';
export { FAST_TIMINGS, type SimTimings } from './timings.js';
export { mulberry32, hashSeed } from './rng.js';
