/**
 * ThreadScreen (`/forum/thread/:id`) — a single topic, phpBB-style (Forums).
 *
 * Breadcrumb (Forum › Board › Thread), thread title with lock/pin markers, then
 * posts rendered with a left author panel (username link to /u/:username,
 * "Member since", post count) + the post body (multiline, pre-wrap) + timestamp
 * + an "edited" marker. A reply composer at the bottom (hidden when locked or not
 * signed in), inline edit for your own posts, pagination, and admin lock/pin.
 *
 * All user text is sanitized on render.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, CharCount } from '../components/common.js';
import { FORUM } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { clockTime, memberSinceLabel } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { ThreadPage, ForumPost } from '../lib/api.js';

const BODY_MAX = 8000;

export function ThreadScreen() {
  const { id } = useParams<{ id: string }>();
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const canPost = !!me && !me.isGuest;
  const isAdmin = !!me?.isAdmin;

  const [page, setPage] = useState(1);
  const [data, setData] = useState<ThreadPage | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const d = await api.fetchThread(id, page);
    setData(d);
    setLoaded(true);
  }, [id, page]);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void (async () => {
      if (!id) return;
      const d = await api.fetchThread(id, page);
      if (live) {
        setData(d);
        setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, page]);

  if (loaded && data === null) {
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <div className="panel panel-pad center">
          <span className="faint">{FORUM.notFound}</span>
        </div>
        <Link className="btn btn-sm" to="/forum">
          ↩ {FORUM.breadcrumbForum}
        </Link>
      </div>
    );
  }

  const thread = data?.thread ?? null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const lastPage = page >= totalPages;

  async function moderate(flags: { locked?: boolean; pinned?: boolean }): Promise<void> {
    if (!id) return;
    const ok = await api.moderateThread(id, flags);
    if (ok) await load();
    else pushInfo(FORUM.postFailed);
  }

  async function reply(body: string): Promise<boolean> {
    if (!id) return false;
    const res = await api.createPost(id, body);
    if (res.ok) {
      // Jump to the last page so the new reply is visible, then reload.
      if (!lastPage) setPage(totalPages);
      await load();
      return true;
    }
    if (res.status === 429) pushInfo(FORUM.slowDown);
    else if (res.status === 403) pushInfo(FORUM.lockedFailed);
    else pushInfo(FORUM.postFailed);
    return false;
  }

  return (
    <div className="page stack forum">
      <nav className="forum-breadcrumb">
        <Link to="/forum">{FORUM.breadcrumbForum}</Link>
        <span aria-hidden="true"> › </span>
        {thread ? (
          <Link to={`/forum/${encodeURIComponent(thread.boardSlug)}`}>
            {sanitizeInline(thread.boardName)}
          </Link>
        ) : (
          <span />
        )}
        <span aria-hidden="true"> › </span>
        <span className="forum-breadcrumb-current">
          {thread ? sanitizeInline(thread.title) : ''}
        </span>
      </nav>

      <div className="spread forum-thread-header">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {thread?.pinned && <span className="badge">{FORUM.pinned}</span>}
          {thread?.locked && <span className="badge">{FORUM.locked}</span>}
          <h1 style={{ margin: 0 }}>{thread ? sanitizeInline(thread.title) : ''}</h1>
        </div>
        {isAdmin && thread && (
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void moderate({ pinned: !thread.pinned })}
            >
              {thread.pinned ? FORUM.modUnpin : FORUM.modPin}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void moderate({ locked: !thread.locked })}
            >
              {thread.locked ? FORUM.modUnlock : FORUM.modLock}
            </button>
          </div>
        )}
      </div>

      {totalPages > 1 && <Pager page={page} totalPages={totalPages} onPage={setPage} />}

      <div className="stack forum-posts">
        {data?.posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            canEdit={(canPost && me?.id === p.authorId) || isAdmin}
            onEdited={load}
          />
        ))}
      </div>

      {totalPages > 1 && <Pager page={page} totalPages={totalPages} onPage={setPage} />}

      {thread?.locked ? (
        <div className="panel panel-pad center" role="note">
          <span className="faint">{FORUM.threadLocked}</span>
        </div>
      ) : canPost ? (
        <ReplyComposer onReply={reply} />
      ) : (
        <div className="panel panel-pad community-signin" role="note">
          <span className="muted">{FORUM.signInToPost}</span>
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  canEdit,
  onEdited,
}: {
  post: ForumPost;
  canEdit: boolean;
  onEdited: () => Promise<void> | void;
}) {
  const pushInfo = useStore((s) => s.pushInfo);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const since = memberSinceLabel(post.authorJoined);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const b = draft.trim();
    if (!b || saving) return;
    setSaving(true);
    const ok = await api.editPost(post.id, b);
    setSaving(false);
    if (ok) {
      setEditing(false);
      pushInfo(FORUM.saved);
      await onEdited();
    } else {
      pushInfo(FORUM.postFailed);
    }
  }

  return (
    <div className="panel forum-post">
      <aside className="forum-post-author">
        <Link
          className="forum-author-name"
          to={`/u/${encodeURIComponent(post.authorName)}`}
        >
          {sanitizeInline(post.authorName)}
        </Link>
        <span className="forum-author-since">
          {since ? FORUM.memberSince(since) : FORUM.memberSinceUnknown}
        </span>
      </aside>
      <div className="forum-post-main">
        <div className="forum-post-bar">
          <span className="forum-post-time" aria-hidden="true">
            {clockTime(post.createdAt)}
          </span>
          {post.editedAt && <span className="forum-post-edited">({FORUM.edited})</span>}
          {canEdit && !editing && (
            <button
              type="button"
              className="btn btn-sm btn-ghost forum-edit-btn"
              onClick={() => {
                setDraft(post.body);
                setEditing(true);
              }}
            >
              {FORUM.edit}
            </button>
          )}
        </div>
        {editing ? (
          <form className="stack" onSubmit={save} style={{ gap: 8 }}>
            <textarea
              className="forum-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, BODY_MAX))}
              maxLength={BODY_MAX}
              rows={5}
              aria-label={FORUM.editPlaceholder}
            />
            <div className="row" style={{ gap: 8 }}>
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={saving || !draft.trim()}
              >
                {saving ? FORUM.saving : FORUM.save}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                {FORUM.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className="forum-post-body">{sanitizeText(post.body)}</div>
        )}
      </div>
    </div>
  );
}

function ReplyComposer({ onReply }: { onReply: (body: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onReply(body);
    setSending(false);
    if (ok) setDraft('');
  }

  return (
    <div className="panel panel-pad stack forum-composer">
      <DecoHead>{FORUM.replyHeading}</DecoHead>
      <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
        <textarea
          className="forum-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, BODY_MAX))}
          placeholder={FORUM.replyPlaceholder}
          maxLength={BODY_MAX}
          rows={5}
          aria-label={FORUM.replyHeading}
          aria-describedby="forum-reply-count"
        />
        <CharCount id="forum-reply-count" len={draft.length} max={BODY_MAX} />
        <div className="row">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sending || !draft.trim()}
          >
            {sending ? FORUM.posting : FORUM.reply}
          </button>
        </div>
      </form>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="forum-pager row" role="navigation">
      <button
        type="button"
        className="btn btn-sm"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        {FORUM.prev}
      </button>
      <span className="faint">{FORUM.pageOf(page, totalPages)}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={page >= totalPages}
        onClick={() => onPage(Math.min(totalPages, page + 1))}
      >
        {FORUM.next}
      </button>
    </div>
  );
}
