/**
 * Platform interface (BUILD_SPEC §14).
 *
 * All Steamworks (or other native-shell) access is wrapped behind this
 * interface so the client never imports `steamworks` directly. Phase A ships
 * only the no-op web implementation; Phase B's Electron app supplies a Steam
 * implementation of the same surface.
 *
 * This module is pure types + a trivial no-op object — no I/O.
 */

/** An opaque auth ticket the server verifies out-of-band (e.g. Steam Web API). */
export interface PlatformAuthTicket {
  /** Provider tag, e.g. 'web' | 'steam'. */
  provider: string;
  /** Provider-specific ticket payload (base64/hex); empty for web. */
  ticket: string;
}

/** Rich-presence fields surfaced to the platform overlay (best-effort). */
export interface RichPresence {
  status?: string;
  /** Invite/connect token mapped to a lobby invite code (§14). */
  connect?: string;
}

/**
 * The platform capability surface (§14): auth tickets, rich presence, friend
 * invites, achievements. Every method is optional-by-result: the web
 * implementation returns inert values so callers need no platform branching.
 */
export interface Platform {
  /** Stable platform name. */
  readonly name: string;
  /** Whether a native game-platform (e.g. Steam) is present. */
  readonly hasNativePlatform: boolean;

  /** Acquire an auth session ticket for server-side verification. */
  getAuthTicket(): Promise<PlatformAuthTicket>;

  /** Update rich presence (no-op on web). */
  setRichPresence(presence: RichPresence): void;

  /** Open the platform's friend-invite UI for a given invite code (no-op on web). */
  inviteFriends(inviteCode: string): void;

  /** Unlock an achievement by id (no-op on web). */
  unlockAchievement(achievementId: string): void;
}

/**
 * The no-op web platform (BUILD_SPEC §14). Used everywhere in Phase A; the
 * browser has no native platform, auth flows through the HTTP API instead.
 */
export const webPlatform: Platform = {
  name: 'web',
  hasNativePlatform: false,
  async getAuthTicket(): Promise<PlatformAuthTicket> {
    return { provider: 'web', ticket: '' };
  },
  setRichPresence(_presence: RichPresence): void {
    // No native overlay on the web; intentionally inert.
  },
  inviteFriends(_inviteCode: string): void {
    // Web invites happen via shareable links, not a platform overlay.
  },
  unlockAchievement(_achievementId: string): void {
    // No achievement backend in Phase A.
  },
};
