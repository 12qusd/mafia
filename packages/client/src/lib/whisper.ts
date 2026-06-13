/**
 * Whisper command parsing (BUILD_SPEC §13.1: `/w <seat> text`).
 *
 * The chat input understands a leading `/w <seat> <text>` command that targets
 * a seat by its DISPLAYED 1-based number (seat labels render `seat + 1`). The
 * parser converts that to the 0-based wire seat id and returns the trailing
 * text. Pure and unit-tested.
 */

import { WHISPER_TEXT_MAX } from '@nocturne/shared';

/** Result of parsing a chat input line. */
export type ParsedInput =
  | { kind: 'chat'; text: string }
  | { kind: 'whisper'; toSeat: number; text: string }
  | { kind: 'empty' }
  | { kind: 'error'; reason: 'bad_seat' | 'no_text' | 'too_long' };

const WHISPER_RE = /^\/w(?:hisper)?\s+(\d+)\s+([\s\S]+)$/i;

/**
 * Parse a raw chat input line.
 *
 * @param raw         the user's typed line
 * @param seatCount   number of seats (display numbers 1..seatCount are valid)
 */
export function parseChatInput(raw: string, seatCount: number): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };

  if (/^\/w(?:hisper)?\b/i.test(trimmed)) {
    const m = WHISPER_RE.exec(trimmed);
    if (!m) {
      // `/w` with no usable target/text.
      return { kind: 'error', reason: 'bad_seat' };
    }
    const display = Number.parseInt(m[1]!, 10);
    const text = m[2]!.trim();
    // Display numbers are 1-based; seat ids are 0-based.
    const toSeat = display - 1;
    if (!Number.isInteger(toSeat) || toSeat < 0 || toSeat >= seatCount) {
      return { kind: 'error', reason: 'bad_seat' };
    }
    if (text.length === 0) return { kind: 'error', reason: 'no_text' };
    if (text.length > WHISPER_TEXT_MAX) return { kind: 'error', reason: 'too_long' };
    return { kind: 'whisper', toSeat, text };
  }

  return { kind: 'chat', text: trimmed };
}

/** Build the input prefix that targets a seat by click-to-whisper. */
export function whisperPrefix(seat: number): string {
  return `/w ${seat + 1} `;
}
