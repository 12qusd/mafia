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

export interface GatewayContext {
  cfg: ServerConfig;
  store: Store;
  identity: IdentityService;
  manager: LobbyManager;
  moderation: Moderation;
  telemetry: Telemetry;
  /** Resolve a display name for an identity id (lobby DTOs, snapshots). */
  nameOf: (identityId: string) => string;
}
