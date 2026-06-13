/**
 * Lazy, loosely-typed facade over `@nocturne/server` (BUILD_SPEC §12.2).
 *
 * The bots' in-process harness needs to boot the real server, but a STATIC
 * `import('@nocturne/server')` would make the bots build depend on the server
 * build — and the server now depends on `@nocturne/bots/runtime` for in-process
 * bot backfill, so that would be a build-order cycle.
 *
 * We break it here: the server is loaded via a dynamic import whose specifier is
 * indirected through a variable so tsc/NodeNext does NOT type-resolve it at build
 * time. A minimal local type describes only what the harness uses. The runtime
 * resolution still works (the workspace symlinks `@nocturne/server` into bots'
 * node_modules via the devDependency).
 */

export interface BuiltAppLike {
  app: { server: { address(): unknown } };
  listen(): Promise<void>;
  shutdown(graceful: boolean): Promise<void>;
  /** Service context (dev:solo reads the in-process LobbyManager for the invite code). */
  ctx: { manager: { getLobby(id: string): { inviteCode: string | null } | undefined } };
}

export interface ServerModuleLike {
  buildApp(cfg: unknown): Promise<BuiltAppLike>;
  loadConfig(env?: NodeJS.ProcessEnv): Record<string, unknown>;
}

let cached: Promise<ServerModuleLike> | null = null;

/** Dynamically load the real server module (CLI/test paths only). */
export function loadServerModule(): Promise<ServerModuleLike> {
  if (!cached) {
    const spec = '@nocturne/server';
    cached = import(spec) as Promise<ServerModuleLike>;
  }
  return cached;
}
