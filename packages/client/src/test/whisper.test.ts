import { describe, it, expect } from 'vitest';
import { parseChatInput, whisperPrefix } from '../lib/whisper.js';

describe('parseChatInput', () => {
  it('parses a plain chat line', () => {
    expect(parseChatInput('hello town', 10)).toEqual({ kind: 'chat', text: 'hello town' });
  });

  it('treats blank input as empty', () => {
    expect(parseChatInput('   ', 10)).toEqual({ kind: 'empty' });
  });

  it('parses /w with a 1-based seat into a 0-based seat id', () => {
    // Display seat 7 → wire seat 6.
    expect(parseChatInput('/w 7 meet me at dawn', 10)).toEqual({
      kind: 'whisper',
      toSeat: 6,
      text: 'meet me at dawn',
    });
  });

  it('accepts the long form /whisper', () => {
    expect(parseChatInput('/whisper 1 hi', 10)).toEqual({ kind: 'whisper', toSeat: 0, text: 'hi' });
  });

  it('rejects an out-of-range seat', () => {
    expect(parseChatInput('/w 11 hi', 10)).toEqual({ kind: 'error', reason: 'bad_seat' });
    expect(parseChatInput('/w 0 hi', 10)).toEqual({ kind: 'error', reason: 'bad_seat' });
  });

  it('rejects /w with no text', () => {
    expect(parseChatInput('/w 3', 10)).toEqual({ kind: 'error', reason: 'bad_seat' });
  });

  it('rejects whisper text over the cap', () => {
    const long = 'x'.repeat(300);
    expect(parseChatInput(`/w 2 ${long}`, 10)).toEqual({ kind: 'error', reason: 'too_long' });
  });

  it('preserves seats containing inner whitespace in the message body', () => {
    expect(parseChatInput('/w 2 a  b   c', 10)).toEqual({ kind: 'whisper', toSeat: 1, text: 'a  b   c' });
  });

  it('whisperPrefix targets the display number', () => {
    expect(whisperPrefix(6)).toBe('/w 7 ');
  });
});
