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

export type TextScale = 'small' | 'normal' | 'large';

/** Client-only display settings (§13.1 Settings). */
export interface ClientSettings {
  profanityFilter: boolean;
  colorblind: boolean;
  textScale: TextScale;
  sound: boolean;
  /** Muted user/guest ids (server-enforced via report/mute is separate; this is the local list). */
  mutedSeats: number[];
}

export const DEFAULT_SETTINGS: ClientSettings = {
  profanityFilter: false,
  colorblind: false,
  textScale: 'normal',
  sound: true,
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
