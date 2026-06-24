/**
 * Local persistence (BUILD_SPEC §7.1, §13.1 Settings).
 *
 * Holds the session token (mirrored from the httpOnly cookie path for WS hello,
 * §7.1) and client-only display preferences. All access is defensive — a
 * sandboxed/blocked localStorage must never crash the app.
 */

const TOKEN_KEY = 'nocturne.token';
const SETTINGS_KEY = 'nocturne.settings';
const GUEST_NAME_KEY = 'nocturne.guestName';
const VERIFY_BANNER_DISMISSED_KEY = 'nocturne.verifyBannerDismissed';
const ONBOARD_DISMISSED_KEY = 'nocturne.onboardDismissed';
const REF_KEY = 'nocturne.ref';

export type TextScale = 'small' | 'normal' | 'large';

/**
 * Cinematic animation layer intensity (goal: three.js noir backdrop + death
 * cinematics).
 * - 'full'    — persistent R3F backdrop, phase transitions, full death cinematics.
 * - 'reduced' — lighter scene (no heavy particles/transitions), instant deaths.
 * - 'off'     — no canvas at all; only the existing CSS scene tint.
 * `prefers-reduced-motion` is always honoured on top of this (it can only
 * downgrade, never upgrade, the effective level).
 */
export type AnimationLevel = 'full' | 'reduced' | 'off';

/** Client-only display settings (§13.1 Settings). */
export interface ClientSettings {
  profanityFilter: boolean;
  colorblind: boolean;
  textScale: TextScale;
  sound: boolean;
  /** Cinematic animation layer intensity (default 'full'). */
  animations: AnimationLevel;
  /** Muted user/guest ids (server-enforced via report/mute is separate; this is the local list). */
  mutedSeats: number[];
}

export const DEFAULT_SETTINGS: ClientSettings = {
  profanityFilter: false,
  colorblind: false,
  textScale: 'normal',
  sound: true,
  animations: 'full',
  mutedSeats: [],
};

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadToken(): string | null {
  return safeGet(TOKEN_KEY);
}
export function saveToken(token: string): void {
  safeSet(TOKEN_KEY, token);
}
export function clearToken(): void {
  safeRemove(TOKEN_KEY);
}

export function loadGuestName(): string | null {
  return safeGet(GUEST_NAME_KEY);
}
export function saveGuestName(name: string): void {
  safeSet(GUEST_NAME_KEY, name);
}

/** Whether the user dismissed the "verify your email" banner (account lifecycle). */
export function loadVerifyBannerDismissed(): boolean {
  return safeGet(VERIFY_BANNER_DISMISSED_KEY) === '1';
}
export function saveVerifyBannerDismissed(): void {
  safeSet(VERIFY_BANNER_DISMISSED_KEY, '1');
}

/** Whether the user dismissed the first-game onboarding welcome (retention). */
export function loadOnboardDismissed(): boolean {
  return safeGet(ONBOARD_DISMISSED_KEY) === '1';
}
export function saveOnboardDismissed(): void {
  safeSet(ONBOARD_DISMISSED_KEY, '1');
}

/**
 * Referral/invite tracking: a `?ref=` value captured from the landing URL and
 * held transiently until the visitor registers (then passed to /api/register).
 * Cleared once consumed so it never sticks across accounts.
 */
export function loadRef(): string | null {
  return safeGet(REF_KEY);
}
export function saveRef(ref: string): void {
  safeSet(REF_KEY, ref);
}
export function clearRef(): void {
  safeRemove(REF_KEY);
}

export function loadSettings(): ClientSettings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<ClientSettings>;
    return {
      profanityFilter: !!parsed.profanityFilter,
      colorblind: !!parsed.colorblind,
      textScale:
        parsed.textScale === 'small' || parsed.textScale === 'large' ? parsed.textScale : 'normal',
      sound: parsed.sound !== false,
      animations:
        parsed.animations === 'reduced' || parsed.animations === 'off' ? parsed.animations : 'full',
      mutedSeats: Array.isArray(parsed.mutedSeats)
        ? parsed.mutedSeats.filter((n): n is number => typeof n === 'number')
        : [],
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: ClientSettings): void {
  safeSet(SETTINGS_KEY, JSON.stringify(s));
}
