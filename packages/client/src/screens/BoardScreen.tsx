/**
 * BoardScreen (`/forum/:boardSlug`) — a board's thread list (Forums feature).
 *
 * phpBB-style: a board header + a "New Topic" composer (signed-in accounts;
 * guests see a sign-in hint), then a thread table with pinned topics first
 * (📌 marker), Replies / Views / Last post columns, and pagination. Posting a
 * topic navigates to the new thread. All user text is sanitized on render.
 */

import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, CharCount } from '../components/common.js';
import { FORUM } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { timeAgo } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { BoardPage, ForumThreadRow } from '../lib/api.js';

const TITLE_MAX = 120;
const BODY_MAX = 8000;

export function BoardScreen() {
  const { boardSlug } = useParams<{ boardSlug: string }>();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const canPost = !!me && !me.isGuest;

  const [page, setPage] = useState(1);
  const [data, setData] = useState<BoardPage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void api.fetchBoard(boardSlug ?? '', page).then((d) => {
      if (!live) return;
      setData(d);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [boardSlug, page]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const t = title.trim();
    const b = body.trim();
    if (t.length < 3 || !b || posting || !boardSlug) return;
    setPosting(true);
    const res = await api.createThread(boardSlug, t, b);
    setPosting(false);
    if (res.ok) {
      setTitle('');
      setBody('');
      setComposing(false);
      if (res.threadId) navigate(`/forum/thread/${encodeURIComponent(res.threadId)}`);
    } else if (res.status === 429) {
      pushInfo(FORUM.slowDown);
    } else if (res.status === 403) {
      pushInfo(FORUM.silenced);
    } else {
      pushInfo(FORUM.postFailed);
    }
  }

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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page stack forum">
      <nav className="forum-breadcrumb">
        <Link to="/forum">{FORUM.breadcrumbForum}</Link>
        <span aria-hidden="true"> › </span>
        <span>{data ? sanitizeInline(data.board.name) : ''}</span>
      </nav>

      <div className="spread forum-board-header">
        <div className="stack" style={{ gap: 2 }}>
          <h1 style={{ margin: 0 }}>{data ? sanitizeInline(data.board.name) : ''}</h1>
          {data?.board.description && (
            <span className="faint">{sanitizeInline(data.board.description)}</span>
          )}
        </div>
        {canPost ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setComposing((v) => !v)}
          >
            {FORUM.newTopic}
          </button>
        ) : null}
      </div>

      {!canPost && (
        <div className="panel panel-pad community-signin" role="note">
          <span className="muted">{FORUM.signInToPost}</span>
        </div>
      )}

      {canPost && composing && (
        <div className="panel panel-pad stack forum-composer">
          <DecoHead>{FORUM.newTopicHeading}</DecoHead>
          <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="forum-title">{FORUM.titleLabel}</label>
              <input
                id="forum-title"
                className="board-input"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder={FORUM.titlePlaceholder}
                maxLength={TITLE_MAX}
                aria-describedby="forum-title-count"
              />
              <CharCount id="forum-title-count" len={title.length} max={TITLE_MAX} />
            </div>
            <div className="field">
              <label htmlFor="forum-body">{FORUM.bodyLabel}</label>
              <textarea
                id="forum-body"
                className="forum-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                placeholder={FORUM.bodyPlaceholder}
                maxLength={BODY_MAX}
                rows={6}
                aria-describedby="forum-body-count"
              />
              <CharCount id="forum-body-count" len={body.length} max={BODY_MAX} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={posting || title.trim().length < 3 || !body.trim()}
              >
                {posting ? FORUM.posting : FORUM.post}
              </button>
              <button type="button" className="btn" onClick={() => setComposing(false)}>
                {FORUM.cancel}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="forum-thread-table" role="table">
        <div className="forum-thread-head" role="row">
          <span role="columnheader">{FORUM.colTopic}</span>
          <span role="columnheader" className="forum-num">
            {FORUM.colReplies}
          </span>
          <span role="columnheader" className="forum-num">
            {FORUM.colViews}
          </span>
          <span role="columnheader" className="forum-last">
            {FORUM.colLastPost}
          </span>
        </div>
        {data && data.threads.length === 0 ? (
          <div className="forum-empty faint">{FORUM.boardEmpty}</div>
        ) : (
          data?.threads.map((t) => <ThreadRow key={t.id} thread={t} />)
        )}
      </div>

      {totalPages > 1 && (
        <Pager page={page} totalPages={totalPages} onPage={setPage} />
      )}
    </div>
  );
}

function ThreadRow({ thread }: { thread: ForumThreadRow }) {
  // Replies = posts minus the opening post.
  const replies = Math.max(0, thread.postCount - 1);
  return (
    <div className={`forum-thread-row ${thread.pinned ? 'forum-pinned' : ''}`} role="row">
      <div className="forum-thread-cell" role="cell">
        <div className="forum-thread-title-line">
          {thread.pinned && (
            <span className="forum-marker" title={FORUM.pinned} aria-label={FORUM.pinned}>
              📌
            </span>
          )}
          {thread.locked && (
            <span className="forum-marker" title={FORUM.locked} aria-label={FORUM.locked}>
              🔒
            </span>
          )}
          <Link className="forum-thread-name" to={`/forum/thread/${encodeURIComponent(thread.id)}`}>
            {sanitizeInline(thread.title)}
          </Link>
        </div>
        <span className="forum-thread-meta">
          {FORUM.startedBy(sanitizeInline(thread.authorName) || '—')}
        </span>
      </div>
      <div className="forum-num" role="cell" data-label={FORUM.colReplies}>
        {replies}
      </div>
      <div className="forum-num" role="cell" data-label={FORUM.colViews}>
        {thread.views}
      </div>
      <div className="forum-last" role="cell">
        <span className="forum-lastpost-meta">
          {thread.lastPosterName ? (
            <>
              {FORUM.by} {sanitizeInline(thread.lastPosterName)}
              <br />
            </>
          ) : null}
          {timeAgo(thread.lastPostAt)}
        </span>
      </div>
    </div>
  );
}

export function Pager({
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
