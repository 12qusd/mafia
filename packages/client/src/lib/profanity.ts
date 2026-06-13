/**
 * Display-only profanity masking (BUILD_SPEC §11.4, §13.1 Settings).
 *
 * The authoritative filter is server-side; this is a *display* toggle that masks
 * a small wordlist when the user opts in. It never blocks sending and never
 * bans. Kept intentionally small and obvious — the real normalization lives on
 * the server.
 */

const WORDLIST = [
  'damn',
  'hell',
  'crap',
  'bastard',
  'ass',
  'bitch',
  'shit',
  'fuck',
  'piss',
  'dick',
  'cock',
  'cunt',
];

const PATTERN = new RegExp(`\\b(${WORDLIST.join('|')})\\b`, 'gi');

/** Replace each matched word with bullets of the same length. */
export function maskProfanity(text: string, enabled: boolean): string {
  if (!enabled) return text;
  return text.replace(PATTERN, (w) => '•'.repeat(w.length));
}
