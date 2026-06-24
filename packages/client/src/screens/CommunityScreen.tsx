/**
 * CommunityScreen (`/community`) — the social district (Social feature).
 *
 * Deliberately an "older internet site": a masthead with a faux visitor counter
 * and "Est. 1928", a global SHOUTBOX (The Wire), a column of topical CHANNELS,
 * and a "Who's around" panel. All boards auto-refresh every few seconds via
 * sinceId delta polling. All user text is sanitized on render; posting is
 * account-only (guests see a sign-in nudge). Motion is gated behind
 * prefers-reduced-motion (no real marquee).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead } from '../components/common.js';
import { COMMUNITY } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { clockTime, isOnline } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { ChatRoom, RoomMessage, FriendItem } from '../lib/api.js';

const SHOUTBOX_POLL_MS = 5000;
const CHANNEL_POLL_MS = 5000;

/** Stable, day-seeded "visitor counter" — period flair, not real telemetry. */
function visitorCount(): number {
  const day = Math.floor(Date.now() / 86_400_000);
  // Deterministic per-day pseudo number in a believably grungy range.
  return 31_400 + ((day * 977) % 9000);
}

export function CommunityScreen() {
  const me = useStore((s) => s.me);
  const canPost = !!me && !me.isGuest;
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const channels = useMemo(() => rooms.filter((r) => r.kind === 'channel'), [rooms]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendItem[]>([]);

  useEffect(() => {
    let live = true;
    void api.fetchRooms().then((r) => {
      if (!live) return;
      setRooms(r);
      const firstChannel = r.find((x) => x.kind === 'channel');
      if (firstChannel) setActiveSlug((cur) => cur ?? firstChannel.slug);
    });
    if (canPost) {
      void api.fetchSocial().then((s) => {
        if (live) setFriends(s.friends);
      });
    }
    return () => {
      live = false;
    };
  }, [canPost]);

  const visitors = useMemo(visitorCount, []);
  const active = channels.find((c) => c.slug === activeSlug) ?? null;

  return (
    <div className="page stack community">
      {/* Masthead — period flair. */}
      <div className="panel panel-pad community-masthead">
        <div className="community-est">{COMMUNITY.est}</div>
        <h1 className="community-title">{COMMUNITY.heading}</h1>
        <p className="muted community-tagline">{COMMUNITY.masthead}</p>
        <div className="community-counter" aria-hidden="true">
          <span className="community-counter-label">{COMMUNITY.visitorsLabel}</span>
          <span className="community-counter-digits">{String(visitors).padStart(7, '0')}</span>
        </div>
      </div>

      {!canPost && (
        <div className="panel panel-pad community-signin" role="note">
          <span className="muted">{COMMUNITY.signInToPost}</span>
        </div>
      )}

      <div className="community-grid">
        {/* The Wire (global shoutbox). */}
        <Shoutbox canPost={canPost} />

        {/* Channels + who's around. */}
        <div className="stack community-side">
          <div className="panel panel-pad stack">
            <DecoHead>{COMMUNITY.channelsHeading}</DecoHead>
            <div
              className="channel-list"
              role="tablist"
              aria-label={COMMUNITY.channelsHeading}
              aria-orientation="vertical"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                e.preventDefault();
                const idx = channels.findIndex((c) => c.slug === activeSlug);
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                const next = channels[(idx + dir + channels.length) % channels.length];
                if (next) {
                  setActiveSlug(next.slug);
                  document.getElementById(`channel-tab-${next.slug}`)?.focus();
                }
              }}
            >
              {channels.map((c) => (
                <button
                  key={c.slug}
                  id={`channel-tab-${c.slug}`}
                  type="button"
                  role="tab"
                  aria-selected={c.slug === activeSlug}
                  tabIndex={c.slug === activeSlug ? 0 : -1}
                  className={`channel-tab ${c.slug === activeSlug ? 'active' : ''}`}
                  onClick={() => setActiveSlug(c.slug)}
                >
                  <span className="channel-tab-name">{c.name}</span>
                  <span className="channel-tab-topic">{c.topic}</span>
                </button>
              ))}
            </div>
          </div>

          <WhosAround friends={friends} />
        </div>
      </div>

      {/* Active channel pane (full width below). */}
      {active && <ChannelPane key={active.slug} room={active} canPost={canPost} />}
    </div>
  );
}

/** A live message list + poster used by both the shoutbox and channels. */
function MessageBoard({
  slug,
  pollMs,
  placeholder,
  postLabel,
  emptyLabel,
  maxLen,
  compact,
  canPost,
}: {
  slug: string;
  pollMs: number;
  placeholder: string;
  postLabel: string;
  emptyLabel: string;
  maxLen: number;
  compact: boolean;
  canPost: boolean;
}) {
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sinceRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Initial load + delta poll.
  useEffect(() => {
    let live = true;
    sinceRef.current = undefined;
    setMessages([]);

    const load = async () => {
      const since = sinceRef.current;
      const next = await api.fetchRoomMessages(slug, since ? { sinceId: since } : { limit: 50 });
      if (!live || next.length === 0) return;
      setMessages((prev) => {
        const merged = since ? [...prev, ...next] : next;
        const last = merged[merged.length - 1];
        if (last) sinceRef.current = last.id;
        return merged.slice(-200);
      });
    };
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [slug, pollMs]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await api.postRoomMessage(slug, body);
    setSending(false);
    if (res.ok) {
      setDraft('');
      setMessages((prev) => {
        sinceRef.current = res.message.id;
        return [...prev, res.message].slice(-200);
      });
    } else if (res.status === 429) {
      pushInfo(COMMUNITY.slowDown);
    } else if (res.status === 403) {
      pushInfo(COMMUNITY.silenced);
    } else {
      pushInfo(COMMUNITY.postFailed);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`board-scroll ${compact ? 'board-compact' : ''}`}>
        {messages.length === 0 ? (
          <div className="faint board-empty">{emptyLabel}</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`board-row ${me && m.userId === me.id ? 'board-mine' : ''}`}>
              <span className="board-time" aria-hidden="true">
                {clockTime(m.createdAt)}
              </span>
              <Link className="board-author" to={`/u/${encodeURIComponent(m.username)}`}>
                {sanitizeInline(m.username)}
              </Link>
              <span className="board-body">{sanitizeText(m.body)}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {canPost ? (
        <form className="board-post" onSubmit={submit}>
          <input
            className="board-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, maxLen))}
            placeholder={placeholder}
            maxLength={maxLen}
            aria-label={placeholder}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={sending || !draft.trim()}>
            {postLabel}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Shoutbox({ canPost }: { canPost: boolean }) {
  return (
    <div className="panel panel-pad stack shoutbox">
      <DecoHead>{COMMUNITY.shoutboxHeading}</DecoHead>
      <div className="faint shoutbox-topic">{COMMUNITY.shoutboxTopic}</div>
      <MessageBoard
        slug="shoutbox"
        pollMs={SHOUTBOX_POLL_MS}
        placeholder={COMMUNITY.shoutboxPlaceholder}
        postLabel={COMMUNITY.shoutboxPost}
        emptyLabel={COMMUNITY.shoutboxEmpty}
        maxLen={280}
        compact
        canPost={canPost}
      />
    </div>
  );
}

function ChannelPane({ room, canPost }: { room: ChatRoom; canPost: boolean }) {
  return (
    <div className="panel panel-pad stack channel-pane">
      <div className="spread">
        <DecoHead>{sanitizeInline(room.name)}</DecoHead>
      </div>
      <div className="faint" style={{ marginTop: -6 }}>
        {sanitizeInline(room.topic)}
      </div>
      <MessageBoard
        slug={room.slug}
        pollMs={CHANNEL_POLL_MS}
        placeholder={COMMUNITY.channelPlaceholder}
        postLabel={COMMUNITY.channelPost}
        emptyLabel={COMMUNITY.channelEmpty}
        maxLen={1000}
        compact={false}
        canPost={canPost}
      />
    </div>
  );
}

function WhosAround({ friends }: { friends: FriendItem[] }) {
  const around = friends.filter((f) => isOnline(f.lastSeen));
  return (
    <div className="panel panel-pad stack">
      <DecoHead>{COMMUNITY.whosAroundHeading}</DecoHead>
      {around.length === 0 ? (
        <span className="faint">{COMMUNITY.whosAroundEmpty}</span>
      ) : (
        <ul className="around-list">
          {around.map((f) => (
            <li key={f.userId} className="around-row">
              <span className="online-dot online-on" aria-hidden="true" />
              <Link className="around-name" to={`/u/${encodeURIComponent(f.username)}`}>
                {sanitizeInline(f.username)}
              </Link>
              <span className="around-status">{COMMUNITY.online}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
