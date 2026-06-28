import { defineConfig } from 'vitest/config';

/**
 * Bots test config.
 *
 * The heavy real-socket integration tests (`socket.test.ts`, `play-again.test.ts`,
 * `reconnect.test.ts`) each boot a real loopback server and drive a *full* bot
 * game over a live WebSocket. A single leg of one of these can legitimately take
 * >10s, and they lean hard on real `setTimeout` timers. Run in the default,
 * heavily-parallel pool on a busy box they contend for CPU + timer wakeups,
 * which made `play-again.test.ts` intermittently blow its drive-loop deadline
 * (it always passed on an isolated re-run).
 *
 * Fix: pin ONLY those three files to a dedicated single-fork pool so they run
 * one-at-a-time, free of CPU/timer contention. Every other bots test stays in
 * the parallel `threads` pool. We also raise the default per-test timeout so a
 * real-socket full game has comfortable head-room under load.
 *
 * `poolMatchGlobs` is the supported mechanism in this Vitest (2.1.x) for routing
 * specific file globs to a different pool: the light tests run in `threads`
 * (parallel), the heavy real-socket files run in `forks` configured as a single
 * shared fork (serial, no contention).
 */
export default defineConfig({
  test: {
    // Light tests run in parallel threads; this is the default for the package.
    pool: 'threads',
    // A real-socket full-game leg can exceed the 5s default under load.
    testTimeout: 45_000,
    hookTimeout: 45_000,
    // Route the heavy real-socket files to the forks pool…
    poolMatchGlobs: [['**/src/__tests__/{socket,play-again,reconnect}.test.ts', 'forks']],
    poolOptions: {
      // …and make that forks pool a SINGLE fork so those three run serially,
      // one at a time, never contending with each other for CPU/timers.
      forks: { singleFork: true },
      // The light tests keep running across multiple worker threads.
      threads: { singleThread: false },
    },
  },
});
