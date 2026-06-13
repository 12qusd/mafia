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

export function DeathFeed({ seatNameFor }: { seatNameFor: (seat: number) => string }) {
  const feed = useStore((s) => s.game?.deathFeed ?? []);
  const dismiss = useStore((s) => s.dismissDeath);

  const item = feed[0];
  if (!item) return null;

  const def = getRole(item.role);
  const name = sanitizeInline(seatNameFor(item.seat));
  const line = strings.deathLine(item.cause, `${item.seat + 1} · ${name}`, def.name);

  return (
    <div className="overlay">
      <div className="panel panel-pad modal stack">
        <div className="row" style={{ gap: 8 }}>
          <IconSkull size={20} />
          <h2 style={{ margin: 0 }}>{GAME.deathFeedTitle}</h2>
        </div>
        <p>{line}</p>
        <div className="spread">
          <FactionTag faction={def.faction} />
          <span className="muted">
            {GAME.cause}: {item.cause}
          </span>
        </div>

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
