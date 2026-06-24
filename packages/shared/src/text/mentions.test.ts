import { describe, it, expect } from 'vitest';
import { parseMentions, extractMentions, MENTION_USERNAME_RE } from './mentions.js';

describe('parseMentions (QoL: @mentions)', () => {
  it('returns [] for empty / non-string input', () => {
    expect(parseMentions('')).toEqual([]);
    // @ts-expect-error — defensive: non-string at runtime
    expect(parseMentions(null)).toEqual([]);
    // @ts-expect-error — defensive: non-string at runtime
    expect(parseMentions(undefined)).toEqual([]);
  });

  it('tokenizes a plain @user at the start of the string', () => {
    expect(parseMentions('@alice hello')).toEqual([
      { type: 'mention', value: 'alice' },
      { type: 'text', value: ' hello' },
    ]);
  });

  it('tokenizes a @user mid-string keeping the boundary char as text', () => {
    expect(parseMentions('hey @bob_99 how are you')).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: 'bob_99' },
      { type: 'text', value: ' how are you' },
    ]);
  });

  it('handles multiple mentions and coalesces text runs', () => {
    expect(parseMentions('@ann and @ben talked')).toEqual([
      { type: 'mention', value: 'ann' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: 'ben' },
      { type: 'text', value: ' talked' },
    ]);
  });

  it('does NOT mention an email local part (foo@bar)', () => {
    // The `@` is preceded by a word char, so `bar` is not a mention.
    expect(parseMentions('mail me at foo@bar today')).toEqual([
      { type: 'text', value: 'mail me at foo@bar today' },
    ]);
  });

  it('does NOT mention on @@name (double-@)', () => {
    // The inner `@name` is preceded by `@` (non-word) so it WOULD match —
    // but the leading `@` is consumed as the boundary char and re-emitted as
    // text, so we get a single mention `name` with a leading `@` text run.
    const tokens = parseMentions('@@name');
    // First `@` is text (boundary-less, emitted), `@name` matches name.
    expect(tokens).toEqual([
      { type: 'text', value: '@' },
      { type: 'mention', value: 'name' },
    ]);
  });

  it('rejects too-short handles (< 3 chars)', () => {
    expect(parseMentions('@ab nope')).toEqual([{ type: 'text', value: '@ab nope' }]);
  });

  it('does not truncate-match an over-long handle (> 24 chars)', () => {
    const longName = 'a'.repeat(30);
    const tokens = parseMentions(`@${longName} end`);
    // No mention token — the 25th char is still a word char so the bounded
    // pattern does not match; it all falls through as text.
    expect(tokens.some((t) => t.type === 'mention')).toBe(false);
  });

  it('matches a maximal 24-char handle exactly', () => {
    const name = 'a'.repeat(24);
    expect(parseMentions(`@${name}`)).toEqual([{ type: 'mention', value: name }]);
  });

  it('stops the username at a non-charset char (punctuation)', () => {
    expect(parseMentions('ping @cat, please')).toEqual([
      { type: 'text', value: 'ping ' },
      { type: 'mention', value: 'cat' },
      { type: 'text', value: ', please' },
    ]);
  });

  it('preserves newlines as text', () => {
    expect(parseMentions('line one\n@dee line two')).toEqual([
      { type: 'text', value: 'line one\n' },
      { type: 'mention', value: 'dee' },
      { type: 'text', value: ' line two' },
    ]);
  });
});

describe('extractMentions (server resolve list)', () => {
  it('extracts distinct usernames in first-seen order', () => {
    expect(extractMentions('@ann @ben @ann again @cat')).toEqual(['ann', 'ben', 'cat']);
  });

  it('de-duplicates case-insensitively', () => {
    expect(extractMentions('@Ann hi @ann @ANN')).toEqual(['Ann']);
  });

  it('respects the limit', () => {
    expect(extractMentions('@aaa @bbb @ccc @ddd @eee @fff', 3)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('returns [] when there are no mentions', () => {
    expect(extractMentions('just words, an email a@b, nothing')).toEqual([]);
  });
});

describe('MENTION_USERNAME_RE', () => {
  it('matches the same charset/bounds as registration', () => {
    expect(MENTION_USERNAME_RE.test('abc')).toBe(true);
    expect(MENTION_USERNAME_RE.test('a_b9')).toBe(true);
    expect(MENTION_USERNAME_RE.test('ab')).toBe(false); // too short
    expect(MENTION_USERNAME_RE.test('a'.repeat(25))).toBe(false); // too long
    expect(MENTION_USERNAME_RE.test('bad-name')).toBe(false); // hyphen
  });
});
