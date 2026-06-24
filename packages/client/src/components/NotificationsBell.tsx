/**
 * NotificationsBell (notifications center, QoL wave) — the topbar bell.
 *
 * A button with an unread-count badge that opens a dropdown listing recent
 * notifications (friend requests/accepts, rank-ups, achievements, @mentions),
 * each with a per-type icon, human noir text, and a link where one makes sense
 * (a profile, the leaderboard). Marks all read on open. Polls every 30s while a
 * registered account is signed in (the same cadence as the DM badge). Hidden
 * for guests / signed-out (account-only feature). All server-derived names are
 * sanitized on render.
 *
 * HTTP + its own table only — this never touches the game WS protocol or the §5
 * leak path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchNotifications, markNotificationsRead, type NotificationItem } from '../lib/api.js';
import { NOTIFICATIONS } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { timeAgo } from '../lib/social.js';
import { Avatar } from './Avatar.js';

/** Poll cadence for the bell — matches the DM-badge poll so it stays warm. */
const POLL_MS = 30_000;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Per-type glyph (decorative; the text always carries the meaning). */
function iconFor(type: NotificationItem['type']): string {
  switch (type) {
    case 'friend_request':
      return '✉';
    case 'friend_accepted':
      return '🤝';
    case 'mention':
      return '@';
    case 'rank_up':
      return '♠';
    case 'achievement':
      return '★';
    default:
      return '•';
  }
}

/** The human line for a notification (names sanitized). */
function textFor(n: NotificationItem): string {
  const p = n.payload;
  switch (n.type) {
    case 'friend_request':
      return NOTIFICATIONS.friendRequest(sanitizeInline(str(p['fromUsername'])) || 'Someone');
    case 'friend_accepted':
      return NOTIFICATIONS.friendAccepted(sanitizeInline(str(p['byUsername'])) || 'Someone');
    case 'mention': {
      const who = sanitizeInline(str(p['fromUsername']) || str(p['byUsername'])) || 'Someone';
      if (p['context'] === 'forum') return NOTIFICATIONS.mentionInForum(who);
      if (p['context'] === 'room') return NOTIFICATIONS.mentionInRoom(who);
      return NOTIFICATIONS.mention(who);
    }
    case 'rank_up':
      return NOTIFICATIONS.rankUp(sanitizeInline(str(p['rankName'])) || 'a new rank');
    case 'achievement':
      return NOTIFICATIONS.achievement(sanitizeInline(str(p['name'])) || 'a commendation');
    default:
      return '';
  }
}

/** The route a notification links to, or null (no navigation). */
function linkFor(n: NotificationItem): string | null {
  const p = n.payload;
  switch (n.type) {
    case 'mention': {
      // Link to where the mention happened: the forum thread or the community
      // chatter. Fall back to the mentioner's profile, then /friends.
      const threadId = str(p['threadId']);
      if (p['context'] === 'forum' && threadId) {
        return `/forum/thread/${encodeURIComponent(threadId)}`;
      }
      if (p['context'] === 'room') return '/community';
      const name = str(p['fromUsername']) || str(p['byUsername']);
      return name ? `/u/${encodeURIComponent(name)}` : '/friends';
    }
    case 'friend_request':
    case 'friend_accepted': {
      // Prefer a username for a clean /u/:username link; fall back to /friends.
      const name = str(p['fromUsername']) || str(p['byUsername']);
      return name ? `/u/${encodeURIComponent(name)}` : '/friends';
    }
    case 'rank_up':
      return '/leaderboard';
    case 'achievement':
      return null;
    default:
      return null;
  }
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const s = await fetchNotifications(30);
    setItems(s.notifications);
    setUnread(s.unread);
  }, []);

  // Poll while mounted (the bell only mounts for a signed-in account).
  useEffect(() => {
    let live = true;
    void refresh();
    const t = setInterval(() => {
      if (live) void refresh();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [refresh]);

  // Close on outside-click / Escape while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    // Mark all read on open (and reflect it locally without a round-trip).
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: Date.now() })));
      const n = await markNotificationsRead();
      if (n >= 0) setUnread(n);
    }
  }

  return (
    <div className="notif-bell" ref={rootRef}>
      <button
        type="button"
        className="linkbtn notif-bell-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          unread > 0 ? `${NOTIFICATIONS.open} — ${NOTIFICATIONS.unreadLabel(unread)}` : NOTIFICATIONS.open
        }
        onClick={() => void toggle()}
        title={NOTIFICATIONS.open}
      >
        <span className="notif-bell-glyph" aria-hidden="true">
          ✦
        </span>
        {unread > 0 && (
          <span className="nav-badge notif-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel panel" role="menu" aria-label={NOTIFICATIONS.title}>
          <div className="notif-panel-head">
            <span className="notif-panel-title">{NOTIFICATIONS.title}</span>
          </div>
          {items.length === 0 ? (
            <div className="notif-empty faint">{NOTIFICATIONS.empty}</div>
          ) : (
            <ul className="notif-list">
              {items.map((n) => {
                const to = linkFor(n);
                const actorId = str(n.payload['fromId']) || str(n.payload['byId']);
                const actorName = str(n.payload['fromUsername']) || str(n.payload['byUsername']);
                const body = (
                  <>
                    {actorId && actorName ? (
                      <Avatar id={actorId} name={actorName} size="sm" />
                    ) : (
                      <span className="notif-icon" aria-hidden="true">
                        {iconFor(n.type)}
                      </span>
                    )}
                    <span className="notif-body">
                      <span className="notif-text">{textFor(n)}</span>
                      <span className="notif-when faint">{timeAgo(n.createdAt)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id} className={`notif-item ${n.readAt ? '' : 'notif-unread'}`} role="menuitem">
                    {to ? (
                      <Link className="notif-link" to={to} onClick={() => setOpen(false)}>
                        {body}
                      </Link>
                    ) : (
                      <span className="notif-link notif-link-static">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
