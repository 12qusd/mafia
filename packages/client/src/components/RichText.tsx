/**
 * RichText — renders ALREADY-SANITIZED user text with two light conventions
 * (QoL "social rendering" wave):
 *
 *   1. @mentions → a `<Link to="/u/:username">@username</Link>` (plain React).
 *   2. Leading `>` lines → a styled `.blockquote` block (a text convention; no
 *      schema, no HTML). Consecutive `>` lines coalesce into one quote block.
 *
 * Security: the input MUST already be passed through `sanitizeText` by the
 * caller. This component does NOT use `dangerouslySetInnerHTML` and renders
 * everything as React text nodes / Links — there is no HTML-injection path.
 * Mentions are parsed with the shared pure `parseMentions`; the username becomes
 * a route param via `encodeURIComponent`, and the visible text is plain.
 *
 * Newlines are preserved (each line is its own row) so multiline posts/messages
 * read correctly.
 */

import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { parseMentions } from '@nocturne/shared';

/** Render one already-sanitized line as text + mention links (no block syntax). */
function renderInline(line: string, keyBase: string): React.ReactNode {
  const tokens = parseMentions(line);
  if (tokens.length === 0) return line;
  return tokens.map((t, i) => {
    if (t.type === 'mention') {
      return (
        <Link key={`${keyBase}-m${i}`} className="mention" to={`/u/${encodeURIComponent(t.value)}`}>
          @{t.value}
        </Link>
      );
    }
    return <Fragment key={`${keyBase}-t${i}`}>{t.value}</Fragment>;
  });
}

/** A parsed block: a run of normal lines, or a run of quoted (`>`) lines. */
type Block = { kind: 'text' | 'quote'; lines: string[] };

/** Group lines into alternating text / blockquote blocks. */
function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    const isQuote = /^\s*>/.test(raw);
    // Strip a single leading `> ` (or `>`) marker from quoted lines.
    const line = isQuote ? raw.replace(/^\s*>\s?/, '') : raw;
    const kind: Block['kind'] = isQuote ? 'quote' : 'text';
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }
  return blocks;
}

/** Render a block's lines, one per row, preserving order + newlines. */
function renderLines(lines: string[], keyBase: string): React.ReactNode {
  return lines.map((line, i) => (
    <Fragment key={`${keyBase}-l${i}`}>
      {i > 0 && <br />}
      {renderInline(line, `${keyBase}-l${i}`)}
    </Fragment>
  ));
}

/**
 * Render already-sanitized `text` with @mention links + `>` blockquotes.
 * `className` is applied to the wrapper (defaults to a generic rich-text class).
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const blocks = toBlocks(text);
  return (
    <span className={className ?? 'richtext'}>
      {blocks.map((b, i) =>
        b.kind === 'quote' ? (
          <blockquote key={`b${i}`} className="blockquote">
            {renderLines(b.lines, `b${i}`)}
          </blockquote>
        ) : (
          <Fragment key={`b${i}`}>{renderLines(b.lines, `b${i}`)}</Fragment>
        ),
      )}
    </span>
  );
}
