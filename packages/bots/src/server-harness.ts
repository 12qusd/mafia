/**
 * In-process real-server harness (BUILD_SPEC §12.2).
 *
 * Boots the REAL server via its app builder in NO_DB mode on an ephemeral port,
 * so the sim/tests drive games over genuine loopback WebSockets against the same
 * gateway humans use. No engine shortcuts (§12.2). The server is imported, not
 * spawned, so tests can start/stop it deterministically.
 */

import { loadServerModule } from './server-facade.js';

export interface RunningServer {
  /** ws://127.0.0.1:PORT/ws for bot connections. */
  wsUrl: string;
  /** http://127.0.0.1:PORT base for any HTTP probes. */
  httpUrl: string;
  port: number;
  shutdown: () => Promise<void>;
}

/**
 * Start the real app on an ephemeral (port 0) loopback listener in NO_DB mode.
 * Returns the resolved ws URL once listening.
 */
export async function startInProcessServer(opts?: { port?: number }): Promise<RunningServer> {
  // The server's loadConfig reads NO_DB / PORT from process.env directly (the
  // env arg only covers HOST/DATABASE_URL/etc.), so we set them on the process
  // before building. NO_DB=1 keeps everything in-memory (§10) — no Postgres.
  process.env.NO_DB = '1';
  if (process.env.DATABASE_URL) delete process.env.DATABASE_URL;
  const reqPort = opts?.port ?? 0;
  process.env.PORT = String(reqPort);
  const { buildApp, loadConfig } = await loadServerModule();
  const cfg = {
    ...loadConfig({
      ...process.env,
      NO_DB: '1',
      HOST: '127.0.0.1',
      PORT: String(reqPort),
    } as NodeJS.ProcessEnv),
    host: '127.0.0.1',
  };
  const built = await buildApp(cfg);
  await built.listen();

  // Resolve the actual bound port (port 0 ⇒ OS-assigned).
  const addr = built.app.server.address() as { port?: number } | string | null;
  const port = typeof addr === 'object' && addr ? (addr.port ?? reqPort) : reqPort;

  return {
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    httpUrl: `http://127.0.0.1:${port}`,
    port,
    shutdown: () => built.shutdown(false),
  };
}

/**
 * Fetch a guest session token over HTTP (POST /api/guest). A bot passes this in
 * `hello.token` to keep a STABLE identity across reconnects — required for the
 * §8 duplicate-takeover and reconnect-resume tests (a fresh `hello` with no token
 * mints a NEW guest each time).
 */
export async function fetchGuestToken(httpUrl: string): Promise<string> {
  const res = await fetch(`${httpUrl}/api/guest`, { method: 'POST' });
  const body = (await res.json()) as { token: string };
  return body.token;
}
