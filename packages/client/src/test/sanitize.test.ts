import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeInline } from '../lib/sanitize.js';

describe('sanitizeText (BUILD_SPEC §11.6, §13.2)', () => {
  it('removes ASCII control characters but keeps newlines/tabs', () => {
    expect(sanitizeText('a\x00b\x1fc')).toBe('abc');
    expect(sanitizeText('line1\nline2')).toBe('line1\nline2');
  });

  it('strips zero-width and bidi-override spoofing characters', () => {
    expect(sanitizeText('ad​min')).toBe('admin');
    expect(sanitizeText('safe‮txet')).toBe('safetxet');
  });

  it('normalizes CRLF to LF', () => {
    expect(sanitizeText('a\r\nb')).toBe('a\nb');
  });

  it('returns empty string for non-strings', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('');
  });

  it('does not pass through HTML as anything but literal text', () => {
    // No HTML interpretation — the string is returned verbatim (React escapes it
    // on render). The point is it is never transformed into markup here.
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('sanitizeInline collapses whitespace and trims', () => {
    expect(sanitizeInline('  Al   Capone \n ')).toBe('Al Capone');
  });
});
