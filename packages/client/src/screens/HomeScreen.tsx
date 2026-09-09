/**
 * Home screen (BUILD_SPEC §13.1): play-as-guest, login/register, join-by-code,
 * create lobby, and the public lobby browser (auto-refreshing).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { strings, SETUPS, MIN_PLAYERS, MAX_PLAYERS, type LobbyVisibility } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { conn } from '../ws/connection.js';
import { useLobbyNav } from '../components/useLobbyNav.js';
import { DecoHead, Switch, TestBadge, CharCount } from '../components/common.js';
import { ProfilePanel } from '../components/ProfilePanel.js';
import { SetupPicker } from '../components/SetupPicker.js';
import { HOME, ONBOARD, SOCIAL_PROOF, FACTION_LABEL } from '../lib/strings-extra.js';
import type { Faction } from '@nocturne/shared';
import { sanitizeInline } from '../lib/sanitize.js';
import {
  loadGuestName,
  loadToken,
  loadOnboardDismissed,
  saveOnboardDismissed,
  loadRef,
  clearRef,
} from '../lib/storage.js';
import { timeAgo } from '../lib/social.js';
import { useCountdown } from '../components/useCountdown.js';
import { useModalA11y } from '../lib/useModalA11y.js';
import { refreshMe } from '../lib/me.js';
import * as api from '../lib/api.js';
import { createLobby, joinLobby, quickPlay, rankedPlay, leaveQueue } from '../ws/actions.js';
import type { LobbyListItem, RecentGame } from '../lib/api.js';

export function HomeScreen() {
  useLobbyNav();
  const guestId = useStore((s) => s.guestId);
  const userId = useStore((s) => s.userId);
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const connection = useStore((s) => s.connection);
  const authed = !!(guestId || userId || loadToken());
  // The WS session is live once we've received a welcome (connection 'open').
  const ready = connection === 'open' && authed;

  return (
    <div className="page home-page stack">
      <section className="start-scene" aria-label="Play Nocturne">
        <div className="start-content">
          <div className="eyebrow">
            <span className="deco-diamond" /> A game of deception & deduction
          </div>
          <h1>NOCTURNE</h1>
          <p className="start-tagline">
            The town sleeps.
            <br />
            <em>Someone doesn’t.</em>
          </p>
          <p className="start-description">
            Take a secret role in a town full of suspects. Read the room, make your move, and live
            to see the morning.
          </p>
          <div className="start-play">
            <button
              className="btn btn-primary btn-quickplay"
              disabled={!ready}
              onClick={() => quickPlay()}
            >
              <span aria-hidden="true">♠</span> {HOME.quickPlay} <span aria-hidden="true">→</span>
            </button>
            <p className="start-note">Play solo or with others · Bots fill empty seats</p>
            <div className="start-secondary">
              <button
                className="linkbtn"
                disabled={!ready}
                onClick={() => {
                  if (!me || me.isGuest) {
                    pushInfo(HOME.rankedSignInPrompt);
                    return;
                  }
                  rankedPlay();
                }}
              >
                {HOME.ranked} <span aria-hidden="true">↗</span>
              </button>
              <Link to="/how-to-play">
                Learn to play <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
          <div className="connection-caption" role="status">
            <span className={`dot ${ready ? 'dot-on' : ''}`} />
            {ready
              ? 'The town is open. Your seat is waiting.'
              : connection === 'connecting' || connection === 'authenticating'
                ? 'Opening the doors…'
                : 'Reconnecting to the town…'}
            {!ready && connection !== 'connecting' && (
              <button className="linkbtn" onClick={() => conn.reauth()}>
                Retry
              </button>
            )}
          </div>
        </div>
        <div className="scene-caption" aria-hidden="true">
          <span>THE TOWN AFTER DARK</span>
          <span>Trust is a dangerous thing.</span>
        </div>
      </section>
      <div className="home-utilities">
        <JoinByCode />
        <details className="home-disclosure">
          <summary>
            <span className="eyebrow">Gather your friends</span>
            <span>
              Host a private table <span aria-hidden="true">＋</span>
            </span>
          </summary>
          {authed ? <CreateLobbyCard /> : <p className="muted">Connecting…</p>}
        </details>
        <details className="home-disclosure">
          <summary>
            <span className="eyebrow">Your identity</span>
            <span>
              Guest name & account <span aria-hidden="true">＋</span>
            </span>
          </summary>
          <AuthCard />
          {me && <ProfilePanel />}
        </details>
      </div>
      <SocialProof />
      <LobbyBrowser onJoin={(id) => joinLobby({ lobbyId: id })} pushInfo={pushInfo} />
      <WelcomeBanner />
      <QuickPlayOverlay />
    </div>
  );
}

/**
 * First-game onboarding welcome (retention). Shown to a guest OR a signed-in
 * account that has not played yet (stats.gamesPlayed === 0). One-line pitch and
 * two CTAs: learn the play, or take the first seat. Dismissal persists locally
 * (mirrors the verify-email banner) so it never nags a returning player.
 */
function WelcomeBanner() {
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const guestId = useStore((s) => s.guestId);
  const connection = useStore((s) => s.connection);
  const [dismissed, setDismissed] = useState(loadOnboardDismissed());

  // A guest, or an account with zero games played, is a first-timer. (An
  // unauthenticated visitor with no identity yet also counts as a newcomer.)
  const isNewcomer =
    !!guestId ||
    (!!me && (me.isGuest || (me.stats !== null && me.stats.gamesPlayed === 0))) ||
    (!me && !guestId);
  if (dismissed || !isNewcomer) return null;

  const ready = connection === 'open';

  function dismiss() {
    saveOnboardDismissed();
    setDismissed(true);
  }

  return (
    <div className="welcome-banner panel panel-pad" role="status">
      <span className="welcome-text">{ONBOARD.pitch}</span>
      <span className="welcome-actions row">
        <button className="btn btn-sm" type="button" onClick={() => navigate('/how-to-play')}>
          {ONBOARD.howTo}
        </button>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          disabled={!ready}
          onClick={() => quickPlay()}
        >
          {ONBOARD.firstGame}
        </button>
        <button
          className="linkbtn"
          type="button"
          aria-label={ONBOARD.dismiss}
          title={ONBOARD.dismissTitle}
          onClick={dismiss}
        >
          {ONBOARD.dismiss}
        </button>
      </span>
    </div>
  );
}

/**
 * Compact live social-proof strip (retention): "<N> souls around" from
 * `/api/stats/online` and a short "Fresh off the table" list of finished games
 * from `/api/games/recent`, both polled ~30s. Degrades silently to nothing when
 * there is no one around and no recent games (e.g. NO_DB / empty endpoints).
 */
function SocialProof() {
  const [online, setOnline] = useState(0);
  const [recent, setRecent] = useState<RecentGame[]>([]);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const [n, games] = await Promise.all([api.fetchOnline(), api.fetchRecentGames(6)]);
      if (!live) return;
      setOnline(n);
      setRecent(games);
    };
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  // Nothing to say ⇒ render nothing (don't show an empty husk).
  if (online <= 0 && recent.length === 0) return null;

  return (
    <div className="social-proof">
      {online > 0 && (
        <span className="souls">
          <span className="souls-dot" aria-hidden="true" />
          {SOCIAL_PROOF.souls(online)}
        </span>
      )}
      {recent.length > 0 && (
        <span className="fresh">
          <span className="fresh-label faint">{SOCIAL_PROOF.freshHeading}:</span>
          {recent.map((g) => {
            const setup = sanitizeInline(g.setupId);
            // Lead with the WINNING faction when the server derived one (e.g.
            // "Town prevailed"); fall back to the setup name when it's null
            // (ambiguous / no winner). Then players · relative-time. The title
            // mirrors the visible text for the tooltip.
            const factionLabel =
              g.winner && g.winner in FACTION_LABEL ? FACTION_LABEL[g.winner as Faction] : null;
            const lead = factionLabel ? SOCIAL_PROOF.prevailed(factionLabel) : setup;
            const meta = `${SOCIAL_PROOF.players(g.players)} · ${timeAgo(g.endedAt)}`;
            return (
              <Link
                key={g.id}
                className="fresh-item"
                to={`/replay/${encodeURIComponent(g.id)}`}
                title={`${lead} · ${meta}`}
              >
                <span className="fresh-setup">{lead}</span>
                <span className="faint"> · {SOCIAL_PROOF.players(g.players)}</span>
                <span className="faint"> · {timeAgo(g.endedAt)}</span>
              </Link>
            );
          })}
        </span>
      )}
    </div>
  );
}

/**
 * "Finding a table…" overlay, shown while the player is in the quick-play queue
 * (`matchmaking` slice, server-sourced). A Cancel sends `leave_queue`; once a
 * table forms the matchmaking slice clears (lobby_state/game_started arrives)
 * and `useLobbyNav` routes into the game.
 */
function QuickPlayOverlay() {
  const matchmaking = useStore((s) => s.matchmaking);
  const dialogRef = useRef<HTMLDivElement>(null);
  const matched = matchmaking?.state === 'matched';
  const seconds = useCountdown(matchmaking?.eta ?? null);
  // Esc cancels the search while still queuing (no-op once matched — the table
  // is forming and the overlay clears itself). Focus is trapped on the dialog.
  useModalA11y(dialogRef, !!matchmaking && !matched, {
    onClose: () => leaveQueue(),
  });
  if (!matchmaking) return null;
  const ranked = matchmaking.mode === 'ranked';
  const searchTitle = ranked ? HOME.rankedSearching : HOME.quickPlaySearching;
  const searchSub = ranked ? HOME.rankedSearchingSub : HOME.quickPlaySearchingSub;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={searchTitle}>
      <div className="modal quickplay-modal" ref={dialogRef}>
        <div className="panel panel-pad">
          <div className="queue-cards" aria-hidden="true">
            <span>♠</span>
            <span>◆</span>
            <span>♣</span>
          </div>
          <h2 className="qp-title">{matched ? HOME.quickPlayMatched : searchTitle}</h2>
          <p className="qp-sub">{matched ? 'Dealing the roles…' : searchSub}</p>
          {!matched && matchmaking.eta !== null && (
            <p className="queue-countdown" role="status">
              {seconds > 0 ? `Your table forms in ${seconds}s` : 'Seating the town…'}
            </p>
          )}
          {!matched && matchmaking.position !== null && matchmaking.queued !== null && (
            <p className="qp-position">
              {HOME.quickPlayPosition(matchmaking.position, matchmaking.queued)}
            </p>
          )}
          {!matched && (
            <button className="btn" onClick={() => leaveQueue()}>
              {HOME.quickPlayCancel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthCard() {
  const [mode, setMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [guestName, setGuestName] = useState(loadGuestName() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guestId = useStore((s) => s.guestId);
  const userId = useStore((s) => s.userId);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'guest') await api.guest(sanitizeInline(guestName) || undefined);
      else if (mode === 'login') await api.login(username, password);
      else {
        // Referral/invite: pass any `?ref=` captured on landing, then clear it
        // (in finally) so a stale/garbled ref never carries over to a retry or a
        // second account. The server treats ref leniently and never blocks on it.
        await api.register(username, password, email || undefined, loadRef() ?? undefined);
      }
      // Rebind the live WS session to the identity we just authenticated as,
      // so the chosen name/account actually takes effect (otherwise the socket
      // stays bound to its initial auto-minted guest).
      conn.reauth();
      // Pull the fresh account/stats so the profile card renders (goal 1).
      void refreshMe();
    } catch {
      setError(HOME.authError);
    } finally {
      // Consume the captured ref once a register was attempted, so it never
      // sticks across retries/accounts (no-op for guest/login paths).
      if (mode === 'register') clearRef();
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad stack">
      <DecoHead>
        {mode === 'guest'
          ? strings.UI.playAsGuest
          : mode === 'login'
            ? HOME.loginHeading
            : HOME.registerHeading}
      </DecoHead>

      {guestId || userId ? (
        <p className="muted">You are at the door. Join a table or start your own.</p>
      ) : null}

      {mode === 'guest' && (
        <div className="field">
          <label htmlFor="auth-guest-name">{HOME.guestNameLabel}</label>
          <input
            id="auth-guest-name"
            value={guestName}
            maxLength={24}
            placeholder={HOME.newGuestName}
            aria-invalid={!!error}
            aria-describedby={error ? 'auth-error' : 'auth-guest-name-count'}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <CharCount id="auth-guest-name-count" len={guestName.length} max={24} />
        </div>
      )}

      {mode !== 'guest' && (
        <>
          <div className="field">
            <label htmlFor="auth-username">{HOME.usernameLabel}</label>
            <input
              id="auth-username"
              value={username}
              autoComplete="username"
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">{HOME.passwordLabel}</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="auth-email">{HOME.emailLabel}</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
        </>
      )}

      {error && (
        <div className="error-text" id="auth-error" role="alert">
          {error}
        </div>
      )}

      <button className="btn btn-primary" disabled={busy} onClick={submit}>
        {mode === 'guest'
          ? strings.UI.playAsGuest
          : mode === 'login'
            ? strings.UI.login
            : strings.UI.register}
      </button>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        {mode !== 'guest' && (
          <button className="linkbtn" onClick={() => setMode('guest')}>
            {HOME.orPlayAsGuest}
          </button>
        )}
        {mode !== 'register' && (
          <button className="linkbtn" onClick={() => setMode('register')}>
            {HOME.switchToRegister}
          </button>
        )}
        {mode !== 'login' && (
          <button className="linkbtn" onClick={() => setMode('login')}>
            {HOME.switchToLogin}
          </button>
        )}
        {mode === 'login' && (
          <Link className="linkbtn" to="/forgot">
            {HOME.forgotPassword}
          </Link>
        )}
      </div>
    </div>
  );
}

function JoinByCode() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  return (
    <div className="panel panel-pad stack">
      <DecoHead>{strings.UI.joinByCode}</DecoHead>
      <div className="row">
        <input
          className="grow"
          value={code}
          maxLength={6}
          placeholder={HOME.joinCodePlaceholder}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        <button
          className="btn"
          disabled={code.length !== 6}
          onClick={() => navigate(`/join/${encodeURIComponent(code)}`)}
        >
          {strings.UI.joinByCode}
        </button>
      </div>
    </div>
  );
}

// Exported for unit tests (the test-mode toggle is admin-only). Not used as a
// route on its own — HomeScreen composes it.
export function CreateLobbyCard() {
  // The server admin-gates test-lobby creation in production, so a normal user
  // toggling Test mode just gets rejected. Only show the toggle to admins; for
  // everyone else `testMode` is hard-false and the control is hidden.
  const isAdmin = useStore((s) => s.me?.isAdmin ?? false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<LobbyVisibility>('private');
  const [setupId, setSetupId] = useState(SETUPS[0]?.id ?? '');
  const [testModeRaw, setTestMode] = useState(false);
  // Defensive: even if state got set true, a non-admin can never create a test
  // lobby — clamp to false so the toggle is purely an admin affordance.
  const testMode = isAdmin && testModeRaw;
  // Test lobbies are forced private (god-view + audit; §5 still law for normal
  // games). The server only honors testMode behind the env/admin gate and will
  // reject with an `error` (forbidden) otherwise — surfaced as a toast.
  const effectiveVisibility: LobbyVisibility = testMode ? 'private' : visibility;

  return (
    <div className="panel panel-pad stack">
      <DecoHead>{HOME.createLobbyHeading}</DecoHead>
      <div>
        <label>{HOME.lobbyNameLabel}</label>
        <input
          value={name}
          maxLength={64}
          placeholder="The Blind Tiger"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label>{HOME.visibilityLabel}</label>
        <select
          value={effectiveVisibility}
          disabled={testMode}
          onChange={(e) => setVisibility(e.target.value as LobbyVisibility)}
        >
          <option value="private">{HOME.visibilityPrivate}</option>
          <option value="public">{HOME.visibilityPublic}</option>
        </select>
      </div>
      <div>
        <label>{HOME.setupLabel}</label>
        <SetupPicker value={setupId} onChange={setSetupId} />
      </div>
      {isAdmin && (
        <div className="toggle">
          <span className="toggle-label">
            {HOME.testModeLabel} <TestBadge />
          </span>
          <Switch on={testMode} label={HOME.testModeLabel} onChange={setTestMode} />
        </div>
      )}
      {isAdmin && testMode && (
        <p className="faint" style={{ fontSize: '0.8em' }}>
          {HOME.testModeHint}
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={name.trim().length === 0}
        onClick={() =>
          createLobby(
            sanitizeInline(name),
            effectiveVisibility,
            setupId,
            testMode ? { testMode: true } : undefined,
          )
        }
      >
        {strings.UI.createLobby}
      </button>
      <p className="faint" style={{ fontSize: '0.8em' }}>
        Tables seat {MIN_PLAYERS}–{MAX_PLAYERS}.
      </p>
    </div>
  );
}

function LobbyBrowser({ onJoin }: { onJoin: (id: string) => void; pushInfo: (s: string) => void }) {
  const [lobbies, setLobbies] = useState<LobbyListItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setLobbies(await api.fetchLobbies());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel panel-pad stack">
      <div className="spread">
        <DecoHead>{HOME.publicLobbies}</DecoHead>
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
          {HOME.refresh}
        </button>
      </div>
      {lobbies.length === 0 ? (
        <p className="muted">{HOME.noLobbies}</p>
      ) : (
        <div className="stack">
          {lobbies.map((l) => (
            <div className="lobby-row" key={l.id}>
              <strong>
                {sanitizeInline(l.name)} {l.testMode && <TestBadge />}
              </strong>
              <span className="muted">
                {l.players}/{l.capacity} {HOME.players}
              </span>
              <span className="muted">{sanitizeInline(l.setupId)}</span>
              <span className="pill">{sanitizeInline(l.status)}</span>
              <button
                className="btn btn-sm"
                disabled={l.status !== 'waiting'}
                onClick={() => onJoin(l.id)}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
