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
import { Avatar } from '../components/Avatar.js';
import { RichText } from '../components/RichText.js';
import { COMMUNITY } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { clockTime, isOnline } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { ChatRoom, RoomMessage, FriendItem, UserHit } from '../lib/api.js';

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
  const isAdmin = !!me?.isAdmin;
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const channels = useMemo(() => rooms.filter((r) => r.kind === 'channel'), [rooms]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendItem[]>([]);

  // Apply a moderation result locally so the lock/slow-mode UI reflects it
  // immediately (the next /api/rooms poll would also pick it up).
  const patchRoom = (slug: string, patch: Partial<ChatRoom>) =>
    setRooms((prev) => prev.map((r) => (r.slug === slug ? { ...r, ...patch } : r)));

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
        <Shoutbox
          room={rooms.find((r) => r.kind === 'shoutbox') ?? null}
          canPost={canPost}
          isAdmin={isAdmin}
          onModerated={patchRoom}
        />

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
                  <span className="channel-tab-name">
                    {c.name}
                    {c.locked && (
                      <span className="channel-lock" title={COMMUNITY.locked} aria-label={COMMUNITY.locked}>
                        🔒
                      </span>
                    )}
                    {c.activeCount > 0 && (
                      <span className="channel-active" title={COMMUNITY.chatting(c.activeCount)}>
                        {COMMUNITY.chatting(c.activeCount)}
                      </span>
                    )}
                  </span>
                  <span className="channel-tab-topic">{c.topic}</span>
                </button>
              ))}
            </div>
          </div>

          <WhosAround friends={friends} />
        </div>
      </div>

      {/* Active channel pane (full width below). */}
      {active && (
        <ChannelPane
          key={active.slug}
          room={active}
          canPost={canPost}
          isAdmin={isAdmin}
          onModerated={patchRoom}
        />
      )}
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
  locked,
  slowModeSec,
  isAdmin,
}: {
  slug: string;
  pollMs: number;
  placeholder: string;
  postLabel: string;
  emptyLabel: string;
  maxLen: number;
  compact: boolean;
  canPost: boolean;
  /** Room moderation state (admin lock + per-room slow-mode floor in seconds). */
  locked: boolean;
  slowModeSec: number;
  isAdmin: boolean;
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

  async function onDelete(messageId: string): Promise<void> {
    const ok = await api.deleteRoomMessage(messageId);
    if (ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, body: '', deleted: true } : m)),
      );
    } else {
      pushInfo(COMMUNITY.postFailed);
    }
  }

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
          messages.map((m) => {
            const mine = !!me && m.userId === me.id;
            const canDelete = (mine || !!me?.isAdmin) && !m.deleted;
            return (
              <div key={m.id} className={`board-row ${mine ? 'board-mine' : ''}`}>
                <span className="board-time" aria-hidden="true">
                  {clockTime(m.createdAt)}
                </span>
                <Link className="board-author" to={`/u/${encodeURIComponent(m.username)}`}>
                  <Avatar id={m.userId} name={m.username} size="sm" />
                  {sanitizeInline(m.username)}
                </Link>
                <span className={`board-body ${m.deleted ? 'msg-removed' : ''}`}>
                  {m.deleted ? COMMUNITY.removed : <RichText text={sanitizeText(m.body)} />}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost msg-del"
                    title={COMMUNITY.deleteMsg}
                    aria-label={COMMUNITY.deleteMsg}
                    onClick={() => void onDelete(m.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      {/* Locked: non-admins see a note instead of the composer; admins may post. */}
      {locked && !isAdmin ? (
        <div className="board-locked-note faint" role="note">
          <span className="board-lock-icon" aria-hidden="true">
            🔒
          </span>{' '}
          {COMMUNITY.lockedNote}
        </div>
      ) : canPost ? (
        <>
          {slowModeSec > 0 && !isAdmin && (
            <div className="faint board-slow-note" role="note">
              {COMMUNITY.slowMode(slowModeSec)}
            </div>
          )}
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
        </>
      ) : null}
    </div>
  );
}

/**
 * Admin-only channel moderation control: toggle lock + set slow-mode. Posts to
 * `/api/rooms/:slug/moderate`; lifts the result to the parent so the lock/slow
 * UI updates immediately. Rendered only for admins (account/admin-gated UI).
 */
function RoomModControls({
  room,
  onModerated,
}: {
  room: ChatRoom;
  onModerated: (slug: string, patch: Partial<ChatRoom>) => void;
}) {
  const pushInfo = useStore((s) => s.pushInfo);
  const [busy, setBusy] = useState(false);

  async function toggleLock(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const next = !room.locked;
    const ok = await api.moderateRoom(room.slug, { locked: next });
    setBusy(false);
    if (ok) onModerated(room.slug, { locked: next });
    else pushInfo(COMMUNITY.modFailed);
  }

  async function setSlow(sec: number): Promise<void> {
    if (busy) return;
    setBusy(true);
    const ok = await api.moderateRoom(room.slug, { slowModeSec: sec });
    setBusy(false);
    if (ok) onModerated(room.slug, { slowModeSec: sec });
    else pushInfo(COMMUNITY.modFailed);
  }

  return (
    <div className="room-mod-controls" role="group" aria-label={COMMUNITY.modSlowLabel}>
      <button
        type="button"
        className={`btn btn-sm ${room.locked ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => void toggleLock()}
        disabled={busy}
        aria-pressed={room.locked}
      >
        {room.locked ? COMMUNITY.modUnlock : COMMUNITY.modLock}
      </button>
      <label className="room-mod-slow">
        {COMMUNITY.modSlowLabel}:{' '}
        <select
          className="select"
          value={room.slowModeSec}
          onChange={(e) => void setSlow(Number(e.target.value))}
          disabled={busy}
          aria-label={COMMUNITY.modSlowLabel}
        >
          <option value={0}>{COMMUNITY.modSlowOff}</option>
          <option value={5}>5s</option>
          <option value={15}>15s</option>
          <option value={30}>30s</option>
        </select>
      </label>
    </div>
  );
}

/** A small "🔒 Locked" badge shown on a moderated room's header. */
function LockBadge() {
  return (
    <span className="room-lock-badge" title={COMMUNITY.locked}>
      <span aria-hidden="true">🔒</span> {COMMUNITY.locked}
    </span>
  );
}

function Shoutbox({
  room,
  canPost,
  isAdmin,
  onModerated,
}: {
  room: ChatRoom | null;
  canPost: boolean;
  isAdmin: boolean;
  onModerated: (slug: string, patch: Partial<ChatRoom>) => void;
}) {
  const locked = room?.locked ?? false;
  const slowModeSec = room?.slowModeSec ?? 0;
  return (
    <div className="panel panel-pad stack shoutbox">
      <div className="spread">
        <DecoHead>{COMMUNITY.shoutboxHeading}</DecoHead>
        {locked && <LockBadge />}
      </div>
      {isAdmin && room && <RoomModControls room={room} onModerated={onModerated} />}
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
        locked={locked}
        slowModeSec={slowModeSec}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function ChannelPane({
  room,
  canPost,
  isAdmin,
  onModerated,
}: {
  room: ChatRoom;
  canPost: boolean;
  isAdmin: boolean;
  onModerated: (slug: string, patch: Partial<ChatRoom>) => void;
}) {
  return (
    <div className="panel panel-pad stack channel-pane">
      <div className="spread">
        <DecoHead>{sanitizeInline(room.name)}</DecoHead>
        {room.locked && <LockBadge />}
      </div>
      {isAdmin && <RoomModControls room={room} onModerated={onModerated} />}
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
        locked={room.locked}
        slowModeSec={room.slowModeSec}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function WhosAround({ friends }: { friends: FriendItem[] }) {
  const around = friends.filter((f) => isOnline(f.lastSeen));
  return (
    <div className="panel panel-pad stack">
      <DecoHead>{COMMUNITY.whosAroundHeading}</DecoHead>
      <PeopleSearch />
      {around.length === 0 ? (
        <span className="faint">{COMMUNITY.whosAroundEmpty}</span>
      ) : (
        <ul className="around-list">
          {around.map((f) => (
            <li key={f.userId} className="around-row">
              <span className="online-dot online-on" aria-hidden="true" />
              <Avatar id={f.userId} name={f.username} size="sm" />
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

/** Debounced username search → links to profiles (social v1). */
function PeopleSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void api.searchUsers(trimmed).then((hits) => {
        if (!live) return;
        setResults(hits);
        setSearched(true);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <input
        className="board-input"
        value={q}
        onChange={(e) => setQ(e.target.value.slice(0, 64))}
        placeholder={COMMUNITY.searchPlaceholder}
        maxLength={64}
        aria-label={COMMUNITY.findPeople}
      />
      {q.trim().length >= 2 && (
        <ul className="around-list" aria-live="polite">
          {results.length === 0 && searched ? (
            <li className="faint">{COMMUNITY.searchEmpty}</li>
          ) : (
            results.map((u) => (
              <li key={u.id} className="around-row">
                <Avatar id={u.id} name={u.username} size="sm" />
                <Link className="around-name" to={`/u/${encodeURIComponent(u.username)}`}>
                  {sanitizeInline(u.username)}
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
