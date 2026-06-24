/**
 * Reset-password screen (account lifecycle): `/reset?token=…`. Enter + confirm a
 * new password and post it with the token. On success the server rotates the
 * password and revokes all other sessions; we show a success note + a sign-in
 * link.
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DecoHead } from '../components/common.js';
import { ACCOUNT } from '../lib/strings-extra.js';
import { resetPassword } from '../lib/api.js';

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (password.length < 8) {
      setError(ACCOUNT.resetTooShort);
      return;
    }
    if (password !== confirm) {
      setError(ACCOUNT.resetMismatch);
      return;
    }
    setBusy(true);
    const ok = await resetPassword(token, password);
    setBusy(false);
    if (ok) setDone(true);
    else setError(ACCOUNT.resetInvalid);
  }

  return (
    <div className="page stack" style={{ maxWidth: 480 }}>
      <h1 className="sr-only">{ACCOUNT.resetHeading}</h1>
      <div className="panel panel-pad stack">
        <DecoHead>{ACCOUNT.resetHeading}</DecoHead>
        {!token ? (
          <>
            <p className="error-text">{ACCOUNT.resetNoToken}</p>
            <Link className="linkbtn" to="/forgot">
              {ACCOUNT.forgotHeading}
            </Link>
          </>
        ) : done ? (
          <>
            <p className="muted">{ACCOUNT.resetSuccess}</p>
            <Link className="linkbtn" to="/">
              {ACCOUNT.resetSignInLink}
            </Link>
          </>
        ) : (
          <>
            <p className="muted">{ACCOUNT.resetSub}</p>
            <div className="field">
              <label htmlFor="reset-password">{ACCOUNT.resetPasswordLabel}</label>
              <input
                id="reset-password"
                type="password"
                value={password}
                maxLength={200}
                autoComplete="new-password"
                aria-invalid={!!error}
                aria-describedby={error ? 'reset-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="reset-confirm">{ACCOUNT.resetConfirmLabel}</label>
              <input
                id="reset-confirm"
                type="password"
                value={confirm}
                maxLength={200}
                autoComplete="new-password"
                aria-invalid={!!error}
                aria-describedby={error ? 'reset-error' : undefined}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
            </div>
            {error && (
              <div className="error-text" id="reset-error" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? ACCOUNT.resetBusy : ACCOUNT.resetSubmit}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
