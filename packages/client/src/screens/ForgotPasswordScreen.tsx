/**
 * Forgot-password screen (account lifecycle): enter a username or email and
 * request a reset link. The server never reveals whether the account exists, so
 * a successful submit always shows the same neutral "if that account exists…"
 * copy (no enumeration).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DecoHead } from '../components/common.js';
import { ACCOUNT } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { forgotPassword } from '../lib/api.js';

export function ForgotPasswordScreen() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const id = sanitizeInline(identifier);
    if (!id) return;
    setError(null);
    setBusy(true);
    const ok = await forgotPassword(id);
    setBusy(false);
    if (ok) setSent(true);
    else setError(ACCOUNT.forgotError);
  }

  return (
    <div className="page stack" style={{ maxWidth: 480 }}>
      <div className="panel panel-pad stack">
        <DecoHead>{ACCOUNT.forgotHeading}</DecoHead>
        {sent ? (
          <>
            <p className="muted">{ACCOUNT.forgotSent}</p>
            <Link className="linkbtn" to="/">
              {ACCOUNT.verifyHomeLink}
            </Link>
          </>
        ) : (
          <>
            <p className="muted">{ACCOUNT.forgotSub}</p>
            <div>
              <label>{ACCOUNT.forgotIdentifierLabel}</label>
              <input
                value={identifier}
                maxLength={254}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {ACCOUNT.forgotSubmit}
            </button>
            <Link className="linkbtn" to="/">
              {ACCOUNT.resetSignInLink}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
