/**
 * Shared service context for the WS gateway and HTTP routes.
 *
 * Bundles the long-lived services so handlers take one object. Constructed once
 * at startup in app.ts.
 */

import type { ServerConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { IdentityService } from '../auth/identity.js';
import type { LobbyManager } from '../lobby/manager.js';
import type { Moderation } from '../moderation/moderation.js';
import type { Telemetry } from '../telemetry.js';
import type { RouteGuardFactory } from '../http/rate-limit.js';
import type { EmailService } from '../email/service.js';

export interface GatewayContext {
  cfg: ServerConfig;
  store: Store;
  identity: IdentityService;
  manager: LobbyManager;
  moderation: Moderation;
  telemetry: Telemetry;
  /** Resolve a display name for an identity id (lobby DTOs, snapshots). */
  nameOf: (identityId: string) => string;
  /**
   * Per-route HTTP rate-limiter factory (Task B). HTTP routes build their own
   * route guards from this. Disabled (every guard a no-op) when the store is
   * non-persistent (NO_DB/test) so the suite is never throttled.
   */
  rateLimit: RouteGuardFactory;
  /**
   * Account-lifecycle email (password reset, verification, welcome). Backed by
   * SMTP when configured, else a log transport (so the flows work unconfigured).
   * All sends are best-effort — a mail failure never affects the request.
   */
  email: EmailService;
}
