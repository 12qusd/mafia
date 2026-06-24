/**
 * "Verify your email" banner (account lifecycle). Shown when a signed-in
 * registered account has an email on file that is not yet confirmed. Offers a
 * "resend link" action and is dismissible (the dismissal is remembered locally
 * so it does not nag every page load). Rendered once at the app shell level.
 */

import { useState } from 'react';
import { useStore } from '../store/store.js';
import { ACCOUNT } from '../lib/strings-extra.js';
import { resendVerification } from '../lib/api.js';
import { loadVerifyBannerDismissed, saveVerifyBannerDismissed } from '../lib/storage.js';

export function VerifyEmailBanner() {
  const me = useStore((s) => s.me);
  const [dismissed, setDismissed] = useState(loadVerifyBannerDismissed());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only for a signed-in account with an unverified email on file.
  const show =
    !!me && !me.isGuest && me.hasEmail && me.emailVerified === false && !dismissed;
  if (!show) return null;

  async function resend() {
    setBusy(true);
    const ok = await resendVerification();
    setBusy(false);
    setNote(ok ? ACCOUNT.bannerResent : ACCOUNT.bannerResendError);
  }

  function dismiss() {
    saveVerifyBannerDismissed();
    setDismissed(true);
  }

  return (
    <div className="verify-banner" role="status">
      <span className="verify-banner-text">{note ?? ACCOUNT.bannerText}</span>
      <span className="verify-banner-actions">
        {!note && (
          <button type="button" className="linkbtn" disabled={busy} onClick={() => void resend()}>
            {ACCOUNT.bannerResend}
          </button>
        )}
        <button
          type="button"
          className="linkbtn"
          aria-label={ACCOUNT.bannerDismiss}
          onClick={dismiss}
        >
          {ACCOUNT.bannerDismiss}
        </button>
      </span>
    </div>
  );
}
