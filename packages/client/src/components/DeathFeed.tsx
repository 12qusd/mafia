/**
 * Dawn death-announcement feed (BUILD_SPEC §13.1): a paced modal showing each
 * death (role, last will, death note, cause) one at a time. The player advances
 * with Continue; the queue drains from the store.
 */

import { getRole } from '@nocturne/shared';
import { strings } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { GAME } from '../lib/strings-extra.js';
import { IconSkull } from './Icons.js';
import { FactionTag } from './common.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';

// Stable empty reference (avoids the Zustand v5 fresh-array selector loop, #185).
const NO_FEED: readonly never[] = [];

export function DeathFeed({ seatNameFor }: { seatNameFor: (seat: number) => string }) {
  const feed = useStore((s) => s.game?.deathFeed ?? NO_FEED);
  const dismiss = useStore((s) => s.dismissDeath);

  const item = feed[0];
  if (!item) return null;

  const name = sanitizeInline(seatNameFor(item.seat));
  const seatText = `${item.seat + 1} · ${name}`;
  // A Janitor-cleaned body (batch A) carries no role: the scene was wiped clean.
  const cleaned = item.cleaned === true || item.role === undefined;
  const def = item.role !== undefined ? getRole(item.role) : null;
  const line = cleaned
    ? strings.cleanedDeathLine(seatText)
    : strings.deathLine(item.cause, seatText, def!.name);

  return (
    <div className="overlay">
      <div className="panel panel-pad modal stack">
        <div className="row" style={{ gap: 8 }}>
          <IconSkull size={20} />
          <h2 style={{ margin: 0 }}>{GAME.deathFeedTitle}</h2>
        </div>
        <p>{line}</p>
        <div className="spread">
          {def ? <FactionTag faction={def.faction} /> : <span className="muted">{GAME.cleanedBody}</span>}
          <span className="muted">
            {GAME.cause}: {item.cause}
          </span>
        </div>

        {!cleaned && (
          <div className="panel panel-pad" style={{ background: 'var(--c-ink)' }}>
            <div className="deco-head">{GAME.lastWillFound}</div>
            {item.lastWill ? (
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{sanitizeText(item.lastWill)}</p>
            ) : (
              <p className="faint" style={{ margin: 0 }}>
                {GAME.noLastWill}
              </p>
            )}
          </div>
        )}

        {item.deathNote && (
          <div className="panel panel-pad" style={{ background: 'var(--c-ink)' }}>
            <div className="deco-head">{GAME.deathNoteFound}</div>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{sanitizeText(item.deathNote)}</p>
          </div>
        )}

        <button className="btn btn-primary" onClick={dismiss}>
          {feed.length > 1 ? `${GAME.deathFeedDismiss} (${feed.length - 1} more)` : GAME.deathFeedDismiss}
        </button>
      </div>
    </div>
  );
}
