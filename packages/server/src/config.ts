/**
 * Server configuration from environment (BUILD_SPEC §4.2, §10).
 *
 * Centralizes every env read so the rest of the server takes a typed config
 * object. Notable: PORT defaults to 8080 (Cloudflare tunnel → localhost:8080);
 * NO_DB=1 runs guests-only with no persistence so dev/bots/CI work without
 * Postgres (§10).
 */

export interface ServerConfig {
  /** HTTP + WS port. Default 8080 (production behind Cloudflare tunnel). */
  port: number;
  /** Bind host. Default 0.0.0.0. */
  host: string;
  /** When true: no Postgres, guests only, in-memory everything (§10). */
  noDb: boolean;
  /** Postgres connection string (ignored when noDb). */
  databaseUrl: string | undefined;
  /** Secret used to derive session-token hashes. */
  sessionSecret: string;
  /** Server build identifier persisted with matches (§10). */
  serverBuild: string;
  /** Max ms a draining server lets running games finish (§4.4, §13.4). */
  drainMaxMs: number;
  /** Directory of the built client to serve statically (§4.2). */
  clientDistDir: string;
  /** Guard the simple admin endpoints with this token (header x-admin-token). */
  adminToken: string | undefined;
  /** Session lifetime in ms. */
  sessionTtlMs: number;
  /** TEST MODE gate (NOCTURNE_TEST_MODE=1): allow non-admins to create test lobbies. */
  testModeEnv: boolean;
  /** True when NODE_ENV==='production'. Tightens cookie security + test-mode logging. */
  production: boolean;
  /**
   * Per-route HTTP rate limits (requests / window). Overridable via env; disabled
   * entirely in NO_DB/non-persistent mode so the test suite (which hammers
   * endpoints) never trips. See {@link RateLimitConfig}.
   */
  rateLimit: RateLimitConfig;
  /** LLM bot config (TEST MODE LLM bots); base url unset ⇒ LLM disabled. */
  llmBaseUrl: string | undefined;
  llmModel: string;
  llmApiKey: string | undefined;
  llmMaxConcurrency: number;
  llmTimeoutMs: number;
  /**
   * Outbound email (account lifecycle: password reset, verification, welcome).
   * When `smtpHost` is unset the transport LOGS each message instead of sending
   * (so the flows are fully functional in dev/unconfigured prod — the operator
   * just drops in SMTP creds later). No secrets ever live in code.
   */
  email: EmailConfig;
  /** Base URL used to build email links (reset / verify). Default mafia.0cs.me. */
  publicBaseUrl: string;
  /**
   * Optional Sentry DSN for error observability. When unset, the error sink is a
   * complete NO-OP (everything still routes through `log.error` as today). When
   * set, @sentry/node is lazily loaded + initialized at boot.
   */
  sentryDsn: string | undefined;
}

/** SMTP knobs (all from env). `smtpHost` unset ⇒ LogTransport (dev/unconfigured). */
export interface EmailConfig {
  smtpHost: string | undefined;
  smtpPort: number;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  /** From address on every outgoing message. */
  from: string;
}

/**
 * Per-route rate-limit knobs (Task B). Each entry is `max` requests per
 * `windowMs`. Defaults come from the BUILD spec; every value is env-overridable.
 * The limiter is bypassed entirely when the store is non-persistent (NO_DB),
 * so the test suite is never throttled.
 */
export interface RateLimitConfig {
  windowMs: number;
  register: number;
  login: number;
  guest: number;
  friendRequest: number;
  profileEdit: number;
  setupCreate: number;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const noDb = envBool('NO_DB', false);
  return {
    port: envInt('PORT', 8080),
    host: env.HOST ?? '0.0.0.0',
    noDb,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
    serverBuild: env.SERVER_BUILD ?? 'dev',
    drainMaxMs: envInt('DRAIN_MAX_MS', 60 * 60 * 1000),
    clientDistDir: env.CLIENT_DIST_DIR ?? '../client/dist',
    adminToken: env.ADMIN_TOKEN,
    sessionTtlMs: envInt('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000),
    testModeEnv: envBool('NOCTURNE_TEST_MODE', false),
    production: (env.NODE_ENV ?? '') === 'production',
    rateLimit: {
      windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
      register: envInt('RATE_LIMIT_REGISTER', 5),
      login: envInt('RATE_LIMIT_LOGIN', 10),
      guest: envInt('RATE_LIMIT_GUEST', 20),
      friendRequest: envInt('RATE_LIMIT_FRIEND_REQUEST', 20),
      profileEdit: envInt('RATE_LIMIT_PROFILE_EDIT', 20),
      setupCreate: envInt('RATE_LIMIT_SETUP_CREATE', 10),
    },
    llmBaseUrl: env.LLM_BASE_URL,
    llmModel: env.LLM_MODEL ?? 'llama3.2',
    llmApiKey: env.LLM_API_KEY,
    llmMaxConcurrency: envInt('LLM_MAX_CONCURRENCY', 2),
    llmTimeoutMs: envInt('LLM_TIMEOUT_MS', 8000),
    email: {
      smtpHost: env.SMTP_HOST,
      smtpPort: envInt('SMTP_PORT', 587),
      smtpUser: env.SMTP_USER,
      smtpPass: env.SMTP_PASS,
      from: env.SMTP_FROM ?? 'Nocturne <no-reply@mafia.0cs.me>',
    },
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'https://mafia.0cs.me').replace(/\/+$/, ''),
    sentryDsn: env.SENTRY_DSN,
  };
}
