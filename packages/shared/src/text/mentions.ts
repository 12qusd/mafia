/**
 * @mentions parsing (QoL "social rendering" wave).
 *
 * A PURE, I/O-free tokenizer shared by the client (to render `@name` as a
 * profile link) and the server (to resolve mentioned accounts for a best-effort
 * notification). It NEVER touches the engine, the game WS protocol, or the §5
 * leak path — it only splits already-sanitized text into plain text + mention
 * tokens.
 *
 * Grammar (matches the app's account rules):
 *  - A mention is `@` immediately followed by a username of 3–24 chars from the
 *    charset `[A-Za-z0-9_]` (same as registration: `^[A-Za-z0-9_]+$`).
 *  - The `@` must NOT be preceded by a word character (so `foo@bar` — i.e. an
 *    email local part — and `a@b` do NOT mention `bar`/`b`). `@@name` is not a
 *    mention either (the inner `@` is preceded by `@`, a non-word char, but the
 *    leading `@` already consumed nothing — see the regex which requires the
 *    char before `@` to be a non-word char OR start-of-string).
 *  - The username is taken greedily but capped at 24 chars; a longer run still
 *    only mentions the first 24 chars and the remainder is plain text. This is
 *    deliberate: a 30-char `@aaa…` does not silently match a non-existent
 *    24-char account — the server still resolves the captured name against real
 *    accounts and a miss is simply not notified.
 *
 * Security: output is structured data only (`{type,value}` tokens). Rendering is
 * the caller's job and must stay plain-React (no HTML injection). There is no
 * markup here.
 */

/** Username charset + length, mirroring registration (`^[A-Za-z0-9_]+$`, 3–24). */
export const MENTION_USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

/**
 * Match `@username` where the `@` is at a word boundary (start of string or
 * after a non-word char) so email-like `foo@bar` does not match. The username
 * run is 3–24 word chars. `\B@` would also work, but an explicit lookbehind-free
 * form keeps this portable. We capture the username in group 1.
 *
 * Note: JS lacks universal lookbehind support targets here, so we instead match
 * an optional leading boundary char OUTSIDE the capture and re-emit it as text
 * (see {@link parseMentions}).
 */
const MENTION_SCAN_RE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,24})(?![A-Za-z0-9_])/g;

/** One token of parsed text: a literal run, or a resolved-by-name mention. */
export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string };

/**
 * Split `text` into an ordered list of text/mention tokens. Pure: the same input
 * always yields the same tokens. `value` on a mention is the bare username
 * (without the leading `@`); `value` on text is the literal run (including any
 * boundary char that preceded an `@`). Adjacent text runs may be coalesced.
 *
 * The `(?![A-Za-z0-9_])` trailing guard means a 25+ char run does NOT match
 * (the char after the 24th is still a word char), so over-long handles fall
 * through as plain text rather than silently truncating to a 24-char mention.
 */
export function parseMentions(text: string): MentionToken[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  // Reset is implicit: we construct a fresh matcher state via matchAll.
  for (const m of text.matchAll(MENTION_SCAN_RE)) {
    const matchStart = m.index ?? 0;
    const boundary = m[1] ?? '';
    const username = m[2] ?? '';
    // The literal slice before this match, plus the boundary char (which is part
    // of the match but is plain text, not the mention).
    const leading = text.slice(lastIndex, matchStart) + boundary;
    if (leading) pushText(tokens, leading);
    tokens.push({ type: 'mention', value: username });
    lastIndex = matchStart + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail) pushText(tokens, tail);
  return tokens;
}

/** Append a text token, coalescing with a trailing text token if present. */
function pushText(tokens: MentionToken[], value: string): void {
  const last = tokens[tokens.length - 1];
  if (last && last.type === 'text') last.value += value;
  else tokens.push({ type: 'text', value });
}

/**
 * Extract up to `limit` DISTINCT mentioned usernames from `text`, preserving
 * first-seen order and de-duplicating case-insensitively (usernames are unique
 * case-insensitively in the app). Used server-side to resolve + notify; the
 * caller still validates each name against a real account.
 */
export function extractMentions(text: string, limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of parseMentions(text)) {
    if (t.type !== 'mention') continue;
    const key = t.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.value);
    if (out.length >= limit) break;
  }
  return out;
}
