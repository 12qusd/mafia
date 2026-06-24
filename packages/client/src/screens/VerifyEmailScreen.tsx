/**
 * Email-verification screen (account lifecycle): `/verify-email?token=…`.
 * Auto-posts the token on mount and shows verified / failed. On success it
 * refreshes `me` so the "verify your email" banner clears immediately.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DecoHead } from '../components/common.js';
import { ACCOUNT } from '../lib/strings-extra.js';
import { verifyEmail } from '../lib/api.js';
import { refreshMe } from '../lib/me.js';

type Status = 'working' | 'done' | 'failed';

export function VerifyEmailScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>(token ? 'working' : 'failed');

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const ok = await verifyEmail(token);
      if (!live) return;
      setStatus(ok ? 'done' : 'failed');
      if (ok) void refreshMe();
    })();
    return () => {
      live = false;
    };
  }, [token]);

  const heading =
    status === 'working'
      ? ACCOUNT.verifyHeadingWorking
      : status === 'done'
        ? ACCOUNT.verifyHeadingDone
        : ACCOUNT.verifyHeadingFailed;

  const body =
    status === 'working'
      ? ACCOUNT.verifyWorking
      : status === 'done'
        ? ACCOUNT.verifyDone
        : token
          ? ACCOUNT.verifyFailed
          : ACCOUNT.verifyNoToken;

  return (
    <div className="page stack" style={{ maxWidth: 480 }}>
      <div className="panel panel-pad stack">
        <DecoHead>{heading}</DecoHead>
        <p className={status === 'failed' ? 'error-text' : 'muted'}>{body}</p>
        {status !== 'working' && (
          <Link className="linkbtn" to="/">
            {ACCOUNT.verifyHomeLink}
          </Link>
        )}
      </div>
    </div>
  );
}
