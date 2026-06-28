/**
 * FriendsScreen (`/friends`) — friends, requests, and direct messages (Social).
 *
 * Left: your made men (online dot + link to /u/:username + Message), incoming
 * requests (Accept/Decline), and outgoing (pending). Right: a DM pane — a thread
 * list and an open conversation with the same poll+post pattern as the boards.
 *
 * Accepts an optional `?to=:userId` query to open a specific conversation. All
 * user text is sanitized on render; the whole screen is account-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead } from '../components/common.js';
import { Avatar } from '../components/Avatar.js';
import { RichText } from '../components/RichText.js';
import { FRIENDS } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { clockTime, isOnline } from '../lib/social.js';
import { prefersReducedMotion } from '../lib/anim.js';
import * as api from '../lib/api.js';
import type { SocialState, DmMessage, DmThreadItem, FriendItem, UserHit } from '../lib/api.js';

const DM_POLL_MS = 5000;
const SOCIAL_POLL_MS = 15_000;
/** Focused typing poll cadence (other party) + outbound ping throttle. */
const TYPING_POLL_MS = 2000;
const TYPING_PING_MS = 2000;
/** Clear the "is typing…" line locally if no fresh true within this window. */
const TYPING_CLEAR_MS = 5000;

const EMPTY: SocialState = {
  friends: [],
  requests: { incoming: [], outgoing: [] },
  threads: [],
  unreadTotal: 0,
};

export function FriendsScreen() {
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const isAccount = !!me && !me.isGuest;
  const [params, setParams] = useSearchParams();
  const [social, setSocial] = useState<SocialState>(EMPTY);
  const [openUserId, setOpenUserId] = useState<string | null>(params.get('to'));

  const reload = useCallback(async () => {
    const s = await api.fetchSocial();
    setSocial(s);
  }, []);

  useEffect(() => {
    if (!isAccount) return;
    void reload();
    const t = setInterval(() => void reload(), SOCIAL_POLL_MS);
    return () => clearInterval(t);
  }, [isAccount, reload]);

  // Open a conversation from the ?to= query when present.
  useEffect(() => {
    const to = params.get('to');
    if (to) setOpenUserId(to);
  }, [params]);

  if (!isAccount) {
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1 style={{ margin: 0 }}>{FRIENDS.heading}</h1>
        <div className="panel panel-pad">
          <p className="muted">{FRIENDS.signInRequired}</p>
        </div>
      </div>
    );
  }

  // The other party for the open thread (prefer a known friend/thread name).
  const openThread = social.threads.find((t) => t.otherUserId === openUserId) ?? null;
  const openFriend = social.friends.find((f) => f.userId === openUserId) ?? null;
  const openName =
    openThread?.otherUsername ?? openFriend?.username ?? (openUserId ? openUserId.slice(0, 8) : '');

  function openConversation(userId: string): void {
    setOpenUserId(userId);
    setParams({ to: userId }, { replace: true });
    // Optimistically clear this thread's unread badge + tell the server.
    setSocial((s) => {
      const cleared = s.threads.find((t) => t.otherUserId === userId)?.unread ?? 0;
      return {
        ...s,
        unreadTotal: Math.max(0, s.unreadTotal - cleared),
        threads: s.threads.map((t) => (t.otherUserId === userId ? { ...t, unread: 0 } : t)),
      };
    });
    void api.markDmRead(userId);
  }

  async function respond(id: string, accept: boolean): Promise<void> {
    await api.respondFriend(id, accept);
    await reload();
  }
  async function remove(userId: string): Promise<void> {
    await api.removeFriend(userId);
    await reload();
  }
  async function addByName(name: string): Promise<void> {
    const res = await api.requestFriend(name);
    if (res.ok) {
      pushInfo(
        res.result === 'accepted'
          ? FRIENDS.addAccepted
          : res.result === 'exists'
            ? FRIENDS.addExists
            : FRIENDS.addSent,
      );
      await reload();
    } else if (res.status === 404) {
      pushInfo(FRIENDS.addNotFound);
    } else if (res.status === 400) {
      pushInfo(FRIENDS.addSelf);
    } else {
      pushInfo(FRIENDS.sendFailed);
    }
  }

  return (
    <div className="page stack">
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h1 style={{ margin: 0 }}>
            {FRIENDS.heading}
            {social.unreadTotal > 0 && (
              <span className="dm-badge" aria-label={`${social.unreadTotal} ${FRIENDS.unread}`}>
                {social.unreadTotal}
              </span>
            )}
          </h1>
          <span className="faint">{FRIENDS.sub}</span>
        </div>
        <Link className="btn btn-sm" to="/community">
          {/* to the boards */}↩ The Community
        </Link>
      </div>

      <div className="friends-grid">
        {/* Left column: people. */}
        <div className="stack">
          <div className="panel panel-pad stack">
            <DecoHead>{FRIENDS.addByNameLabel}</DecoHead>
            <UserSearch onAdd={addByName} />
          </div>

          {social.requests.incoming.length > 0 && (
            <div className="panel panel-pad stack">
              <DecoHead>{FRIENDS.incomingHeading}</DecoHead>
              <ul className="friend-list">
                {social.requests.incoming.map((r) => (
                  <li key={r.id} className="friend-row">
                    <Link className="friend-name" to={`/u/${encodeURIComponent(r.username)}`}>
                      {sanitizeInline(r.username)}
                    </Link>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => void respond(r.id, true)}>
                        {FRIENDS.accept}
                      </button>
                      <button className="btn btn-sm" onClick={() => void respond(r.id, false)}>
                        {FRIENDS.decline}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel panel-pad stack">
            <DecoHead>{FRIENDS.friendsHeading}</DecoHead>
            {social.friends.length === 0 ? (
              <span className="faint">{FRIENDS.friendsEmpty}</span>
            ) : (
              <ul className="friend-list">
                {social.friends.map((f) => (
                  <FriendRow
                    key={f.userId}
                    friend={f}
                    onMessage={() => openConversation(f.userId)}
                    onRemove={() => void remove(f.userId)}
                  />
                ))}
              </ul>
            )}
          </div>

          {social.requests.outgoing.length > 0 && (
            <div className="panel panel-pad stack">
              <DecoHead>{FRIENDS.outgoingHeading}</DecoHead>
              <ul className="friend-list">
                {social.requests.outgoing.map((r) => (
                  <li key={r.id} className="friend-row">
                    <Link className="friend-name" to={`/u/${encodeURIComponent(r.username)}`}>
                      {sanitizeInline(r.username)}
                    </Link>
                    <span className="badge">{FRIENDS.pending}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right column: DMs. */}
        <div className="stack">
          <div className="panel panel-pad stack">
            <DecoHead>{FRIENDS.threadsHeading}</DecoHead>
            {social.threads.length === 0 ? (
              <span className="faint">{FRIENDS.threadsEmpty}</span>
            ) : (
              <ul className="thread-list">
                {social.threads.map((t) => (
                  <ThreadRow
                    key={t.threadId}
                    thread={t}
                    active={t.otherUserId === openUserId}
                    onOpen={() => openConversation(t.otherUserId)}
                  />
                ))}
              </ul>
            )}
          </div>

          {openUserId ? (
            <Conversation
              key={openUserId}
              otherUserId={openUserId}
              otherName={openName}
              meId={me!.id}
              onSent={reload}
            />
          ) : (
            <div className="panel panel-pad center" style={{ minHeight: 100 }}>
              <span className="faint">{FRIENDS.dmPickThread}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendRow({
  friend,
  onMessage,
  onRemove,
}: {
  friend: FriendItem;
  onMessage: () => void;
  onRemove: () => void;
}) {
  const online = isOnline(friend.lastSeen);
  return (
    <li className="friend-row">
      <div className="row" style={{ gap: 8 }}>
        <span className={`online-dot ${online ? 'online-on' : 'online-off'}`} aria-hidden="true" />
        <Avatar id={friend.userId} name={friend.username} size="sm" />
        <Link className="friend-name" to={`/u/${encodeURIComponent(friend.username)}`}>
          {sanitizeInline(friend.username)}
        </Link>
        <span className="faint" style={{ fontSize: '0.85em' }}>
          {online ? FRIENDS.online : FRIENDS.offline}
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={onMessage}>
          {FRIENDS.message}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onRemove} title={FRIENDS.remove}>
          ×
        </button>
      </div>
    </li>
  );
}

function ThreadRow({
  thread,
  active,
  onOpen,
}: {
  thread: DmThreadItem;
  active: boolean;
  onOpen: () => void;
}) {
  const unread = !active && thread.unread > 0;
  return (
    <li>
      <button
        type="button"
        className={`thread-tab ${active ? 'active' : ''} ${unread ? 'thread-unread' : ''}`}
        onClick={onOpen}
      >
        <span className="thread-name">
          <Avatar id={thread.otherUserId} name={thread.otherUsername} size="sm" />
          {sanitizeInline(thread.otherUsername)}
          {unread && (
            <span className="dm-badge" aria-label={`${thread.unread} ${FRIENDS.unread}`}>
              {thread.unread}
            </span>
          )}
        </span>
        <span className="thread-preview">{sanitizeInline(thread.preview)}</span>
      </button>
    </li>
  );
}

/** Live username search → result list with an Add-friend action (social v1). */
function UserSearch({ onAdd }: { onAdd: (name: string) => void | Promise<void> }) {
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
    <div className="stack" style={{ gap: 8 }}>
      <input
        className="board-input"
        value={q}
        onChange={(e) => setQ(e.target.value.slice(0, 64))}
        placeholder={FRIENDS.searchPlaceholder}
        maxLength={64}
        aria-label={FRIENDS.addByNameLabel}
      />
      {q.trim().length >= 2 && (
        <ul className="friend-list" aria-live="polite">
          {results.length === 0 && searched ? (
            <li className="faint">{FRIENDS.searchEmpty}</li>
          ) : (
            results.map((u) => (
              <li key={u.id} className="friend-row">
                <div className="row" style={{ gap: 8 }}>
                  <Avatar id={u.id} name={u.username} size="sm" />
                  <Link className="friend-name" to={`/u/${encodeURIComponent(u.username)}`}>
                    {sanitizeInline(u.username)}
                  </Link>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void onAdd(u.username)}
                >
                  {FRIENDS.add}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Conversation({
  otherUserId,
  otherName,
  meId,
  onSent,
}: {
  otherUserId: string;
  otherName: string;
  meId: string;
  onSent: () => void;
}) {
  const pushInfo = useStore((s) => s.pushInfo);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const sinceRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Last outbound typing ping (ms) for the client-side throttle.
  const lastPingRef = useRef<number>(0);
  // Timer that clears the "is typing…" line after TYPING_CLEAR_MS of no truthy
  // poll, so a stale indicator never sticks if polling pauses.
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    sinceRef.current = undefined;
    setMessages([]);
    setOtherTyping(false);
    const load = async () => {
      const since = sinceRef.current;
      const res = await api.fetchDms(otherUserId, since ? { sinceId: since } : { limit: 50 });
      if (!live || !res || res.messages.length === 0) return;
      setMessages((prev) => {
        const merged = since ? [...prev, ...res.messages] : res.messages;
        const last = merged[merged.length - 1];
        if (last) sinceRef.current = last.id;
        return merged.slice(-200);
      });
    };
    void load();
    const t = setInterval(() => void load(), DM_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [otherUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  /** Apply a fresh typing verdict: show + (re)arm the local clear timer on true. */
  const applyTyping = useCallback((typing: boolean) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    if (typing) {
      setOtherTyping(true);
      clearTimerRef.current = setTimeout(() => setOtherTyping(false), TYPING_CLEAR_MS);
    } else {
      setOtherTyping(false);
    }
  }, []);

  // Focused typing poll while the conversation is open (~2s), independent of the
  // 5s message poll so the indicator feels live without refetching messages.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const typing = await api.fetchTyping(otherUserId);
      if (live) applyTyping(typing);
    };
    void poll();
    const t = setInterval(() => void poll(), TYPING_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [otherUserId, applyTyping]);

  /** Update the draft and send a throttled typing ping (≤1 per TYPING_PING_MS). */
  function onDraftChange(value: string): void {
    setDraft(value.slice(0, 1000));
    const now = Date.now();
    if (value.trim() && now - lastPingRef.current >= TYPING_PING_MS) {
      lastPingRef.current = now;
      void api.pingTyping(otherUserId);
    }
  }

  async function onDelete(messageId: string): Promise<void> {
    const ok = await api.deleteDm(messageId);
    if (ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, body: '', deleted: true } : m)),
      );
    } else {
      pushInfo(FRIENDS.sendFailed);
    }
  }

  /** Lighter "reply" affordance: prefill the (single-line) input with a `> `
   *  quote of the chosen message, collapsed inline so it fits the input. The
   *  recipient still sees a styled blockquote (RichText renders leading `>`). */
  function quote(m: DmMessage): void {
    if (m.deleted) return;
    const inline = sanitizeInline(m.body);
    if (!inline) return;
    setDraft((cur) => `> ${inline}\n${cur}`.slice(0, 1000));
    document.getElementById('dm-input')?.focus();
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await api.postDm(otherUserId, body);
    setSending(false);
    if (res.ok) {
      setDraft('');
      setMessages((prev) => {
        sinceRef.current = res.message.id;
        return [...prev, res.message].slice(-200);
      });
      onSent();
    } else if (res.status === 429) {
      pushInfo(FRIENDS.sendFailed);
    } else if (res.status === 403) {
      pushInfo(FRIENDS.silenced);
    } else {
      pushInfo(FRIENDS.sendFailed);
    }
  }

  return (
    <div className="panel panel-pad stack dm-pane">
      <DecoHead>
        <Link className="friend-name" to={`/u/${encodeURIComponent(otherName)}`}>
          <Avatar id={otherUserId} name={otherName} size="md" />
          {sanitizeInline(otherName)}
        </Link>
      </DecoHead>
      <div className="board-scroll dm-scroll">
        {messages.length === 0 ? (
          <div className="faint board-empty">{FRIENDS.dmEmpty}</div>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === meId;
            return (
              <div key={m.id} className={`dm-row ${mine ? 'dm-mine' : 'dm-theirs'}`}>
                <span className={`dm-bubble ${m.deleted ? 'msg-removed' : ''}`}>
                  {m.deleted ? FRIENDS.removed : <RichText text={sanitizeText(m.body)} />}
                </span>
                <span className="dm-time" aria-hidden="true">
                  {clockTime(m.createdAt)}
                </span>
                {!m.deleted && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost msg-del"
                    title={FRIENDS.replyTo}
                    aria-label={FRIENDS.replyTo}
                    onClick={() => quote(m)}
                  >
                    ↩
                  </button>
                )}
                {mine && !m.deleted && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost msg-del"
                    title={FRIENDS.deleteDm}
                    aria-label={FRIENDS.deleteDm}
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
      {otherTyping && (
        <div className={`dm-typing ${prefersReducedMotion() ? '' : 'dm-typing-anim'}`} aria-live="polite">
          {FRIENDS.typing.replace('%s', sanitizeInline(otherName))}
        </div>
      )}
      <form className="board-post" onSubmit={submit}>
        <input
          id="dm-input"
          className="board-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={FRIENDS.dmPlaceholder}
          maxLength={1000}
          aria-label={FRIENDS.dmPlaceholder}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={sending || !draft.trim()}>
          {FRIENDS.dmSend}
        </button>
      </form>
    </div>
  );
}
