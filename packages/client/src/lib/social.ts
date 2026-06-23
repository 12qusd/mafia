/**
 * Small client-side helpers shared across the Social screens (Community,
 * public Profile, Friends): online detection, a compact relative-time format,
 * and the accent-flair allowlist (the server only length-caps accent; the
 * client validates it against this list of faction-flavored keys).
 */

/** A player is "around" if seen within this window (mirrors the server hint). */
export const ONLINE_WINDOW_MS = 120_000;

/** True if `lastSeen` (epoch ms) is recent enough to count as online. */
export function isOnline(lastSeen: number | null): boolean {
  return lastSeen !== null && Date.now() - lastSeen < ONLINE_WINDOW_MS;
}

/** A compact "time since" label, e.g. "just now", "4m", "2h", "3d". */
export function timeAgo(at: number | null): string {
  if (at === null) return '';
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Clock-time HH:MM for a chat line timestamp. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Member-since calendar label, e.g. "Mar 1928". Empty when unknown. */
export function memberSinceLabel(at: number | null): string {
  if (at === null) return '';
  return new Date(at).toLocaleDateString([], { year: 'numeric', month: 'short' });
}

/** Accent-flair options (key → label). Free text server-side, allowlisted here. */
export const ACCENT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: '', label: 'None' },
  { key: 'town', label: 'Town' },
  { key: 'mafia', label: 'Mafia' },
  { key: 'triad', label: 'Triad' },
  { key: 'vampire', label: 'Vampire' },
  { key: 'cult', label: 'Cult' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'brass', label: 'Brass' },
  { key: 'verdigris', label: 'Verdigris' },
];

const ACCENT_KEYS = new Set(ACCENT_OPTIONS.map((o) => o.key));

/** The accent key if it is in the allowlist, else '' (no flair). */
export function normalizeAccent(accent: string | null): string {
  return accent && ACCENT_KEYS.has(accent) ? accent : '';
}
