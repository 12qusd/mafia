/**
 * Text sanitization + profanity filtering (BUILD_SPEC §11.4, §11.6).
 *
 * All rendered text (chat, names, wills, notes) is plain text only: strip
 * control characters, collapse whitespace runs, enforce length caps. The client
 * never renders HTML/markdown (XSS prevention is layered: server stores plain
 * text, client renders as text). The profanity filter is server-side and
 * advisory only — it sets a `filtered` flag the client may toggle; it NEVER
 * auto-bans (§11.4).
 */

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  TextCensor,
} from 'obscenity';

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
const censor = new TextCensor();

// Zero-width / bidi format characters (0x200B-0x200F, 0x202A-0x202E, 0x2060,
// 0xFEFF) that enable display spoofing — REMOVED outright (no replacement).
const FORMAT_CHARS = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]', 'g');
// C0 controls (0x00-0x1F), DEL (0x7F), C1 controls (0x80-0x9F) — replaced with a
// space so adjacent words don't merge. Built from \u escapes to avoid embedding
// literal control bytes in source.
// eslint-disable-next-line no-control-regex -- stripping control chars is the point (§11.6)
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
// Same but keep \n (0x0A) and \t (0x09) for multiline fields.
// eslint-disable-next-line no-control-regex -- stripping control chars is the point (§11.6)
const CONTROL_CHARS_KEEP_NL = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]', 'g');

/**
 * Strip control chars, normalize whitespace to single spaces, trim, and hard-cap
 * length. Returns plain text safe to store and later render as text.
 */
export function sanitizeText(input: string, maxLen: number): string {
  let out = input.replace(FORMAT_CHARS, '').replace(CONTROL_CHARS, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Multi-line variant for wills/notes: preserve newlines but strip other control
 * chars and cap length.
 */
export function sanitizeMultiline(input: string, maxLen: number): string {
  let out = input.replace(FORMAT_CHARS, '').replace(CONTROL_CHARS_KEEP_NL, '');
  out = out.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  out = out
    .split('\n')
    .map((l) => l.replace(/ +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/** True if the text contains profanity per the wordlist (advisory). */
export function hasProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}

/** Return a censored copy of the text (asterisks) for the filtered view. */
export function censorText(text: string): string {
  const matches = matcher.getAllMatches(text);
  return censor.applyTo(text, matches);
}

/**
 * Process a chat/whisper body: sanitize, then compute the profanity flag and a
 * censored variant. The client toggles which it renders (§11.4).
 */
export interface ProcessedText {
  text: string;
  filtered: string;
  hasProfanity: boolean;
}

export function processChat(input: string, maxLen: number): ProcessedText {
  const text = sanitizeText(input, maxLen);
  const flagged = hasProfanity(text);
  return { text, filtered: flagged ? censorText(text) : text, hasProfanity: flagged };
}
