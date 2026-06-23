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
import { FRIENDS } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { clockTime, isOnline } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { SocialState, DmMessage, DmThreadItem, FriendItem } from '../lib/api.js';

const DM_POLL_MS = 5000;
const SOCIAL_POLL_MS = 15_000;

const EMPTY: SocialState = { friends: [], requests: { incoming: [], outgoing: [] }, threads: [] };

export function FriendsScreen() {
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const isAccount = !!me && !me.isGuest;
  const [params, setParams] = useSearchParams();
  const [social, setSocial] = useState<SocialState>(EMPTY);
  const [openUserId, setOpenUserId] = useState<string | null>(params.get('to'));
  const [addName, setAddName] = useState('');

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
  }

  async function respond(id: string, accept: boolean): Promise<void> {
    await api.respondFriend(id, accept);
    await reload();
  }
  async function remove(userId: string): Promise<void> {
    await api.removeFriend(userId);
    await reload();
  }
  async function addByName(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    const res = await api.requestFriend(name);
    if (res.ok) {
      pushInfo(
        res.result === 'accepted'
          ? FRIENDS.addAccepted
          : res.result === 'exists'
            ? FRIENDS.addExists
            : FRIENDS.addSent,
      );
      setAddName('');
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
          <h1 style={{ margin: 0 }}>{FRIENDS.heading}</h1>
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
            <form className="board-post" onSubmit={addByName}>
              <input
                className="board-input"
                value={addName}
                onChange={(e) => setAddName(e.target.value.slice(0, 64))}
                placeholder={FRIENDS.addByNamePlaceholder}
                maxLength={64}
                aria-label={FRIENDS.addByNameLabel}
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={!addName.trim()}>
                {FRIENDS.add}
              </button>
            </form>
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
  return (
    <li>
      <button type="button" className={`thread-tab ${active ? 'active' : ''}`} onClick={onOpen}>
        <span className="thread-name">{sanitizeInline(thread.otherUsername)}</span>
        <span className="thread-preview">{sanitizeInline(thread.preview)}</span>
      </button>
    </li>
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
  const sinceRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    sinceRef.current = undefined;
    setMessages([]);
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
          {sanitizeInline(otherName)}
        </Link>
      </DecoHead>
      <div className="board-scroll dm-scroll">
        {messages.length === 0 ? (
          <div className="faint board-empty">{FRIENDS.dmEmpty}</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`dm-row ${m.senderId === meId ? 'dm-mine' : 'dm-theirs'}`}>
              <span className="dm-bubble">{sanitizeText(m.body)}</span>
              <span className="dm-time" aria-hidden="true">
                {clockTime(m.createdAt)}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <form className="board-post" onSubmit={submit}>
        <input
          className="board-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
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
