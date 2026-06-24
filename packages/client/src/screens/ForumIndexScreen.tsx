/**
 * ForumIndexScreen (`/forum`) — a classic phpBB-style board index (Forums
 * feature). Each category is a header bar; under it a table of boards with
 * Topics / Posts / Last post columns. Board names link to the board. A
 * deliberate "old internet" register laid over the noir deco system.
 *
 * Public read — guests and anon see the same index. All user text is sanitized
 * on render.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InlineLoader } from '../components/common.js';
import { FORUM } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { timeAgo } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { ForumIndexCategory, ForumIndexBoard } from '../lib/api.js';

export function ForumIndexScreen() {
  const [index, setIndex] = useState<ForumIndexCategory[] | null>(null);

  useEffect(() => {
    let live = true;
    void api.fetchForumIndex().then((i) => {
      if (live) setIndex(i);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="page stack forum">
      <div className="panel panel-pad forum-masthead">
        <div className="community-est">{FORUM.est}</div>
        <h1 className="community-title">{FORUM.heading}</h1>
        <p className="muted community-tagline">{FORUM.sub}</p>
      </div>

      {index === null ? (
        <div className="panel panel-pad center">
          <InlineLoader label={FORUM.loading} />
        </div>
      ) : (
        index.map((cat) => (
          <div key={cat.category.slug} className="forum-category">
            <div className="forum-cat-bar">{sanitizeInline(cat.category.name)}</div>
            <div className="forum-board-table" role="table">
              <div className="forum-board-head" role="row">
                <span role="columnheader">{FORUM.colBoard}</span>
                <span role="columnheader" className="forum-num">
                  {FORUM.colTopics}
                </span>
                <span role="columnheader" className="forum-num">
                  {FORUM.colPosts}
                </span>
                <span role="columnheader" className="forum-last">
                  {FORUM.colLastPost}
                </span>
              </div>
              {cat.boards.map((b) => (
                <BoardRow key={b.slug} board={b} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BoardRow({ board }: { board: ForumIndexBoard }) {
  return (
    <div className="forum-board-row" role="row">
      <div className="forum-board-cell" role="cell">
        <Link className="forum-board-name" to={`/forum/${encodeURIComponent(board.slug)}`}>
          {sanitizeInline(board.name)}
        </Link>
        {board.description && (
          <span className="forum-board-desc">{sanitizeInline(board.description)}</span>
        )}
      </div>
      <div className="forum-num" role="cell" data-label={FORUM.colTopics}>
        {board.threadCount}
      </div>
      <div className="forum-num" role="cell" data-label={FORUM.colPosts}>
        {board.postCount}
      </div>
      <div className="forum-last" role="cell">
        {board.lastPost ? (
          <Link
            className="forum-lastpost"
            to={`/forum/thread/${encodeURIComponent(board.lastPost.threadId)}`}
          >
            <span className="forum-lastpost-title">
              {sanitizeInline(board.lastPost.threadTitle)}
            </span>
            <span className="forum-lastpost-meta">
              {FORUM.by} {sanitizeInline(board.lastPost.username)} · {timeAgo(board.lastPost.at)}
            </span>
          </Link>
        ) : (
          <span className="faint">{FORUM.noLastPost}</span>
        )}
      </div>
    </div>
  );
}
