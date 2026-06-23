/**
 * Home screen (BUILD_SPEC §13.1): play-as-guest, login/register, join-by-code,
 * create lobby, and the public lobby browser (auto-refreshing).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { strings, SETUPS, MIN_PLAYERS, MAX_PLAYERS, type LobbyVisibility } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { conn } from '../ws/connection.js';
import { useLobbyNav } from '../components/useLobbyNav.js';
import { DecoHead, Switch, TestBadge } from '../components/common.js';
import { ProfilePanel } from '../components/ProfilePanel.js';
import { SetupPicker } from '../components/SetupPicker.js';
import { HOME } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { loadGuestName, loadToken } from '../lib/storage.js';
import { refreshMe } from '../lib/me.js';
import * as api from '../lib/api.js';
import { createLobby, joinLobby, quickPlay, rankedPlay, leaveQueue } from '../ws/actions.js';
import type { LobbyListItem } from '../lib/api.js';

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
    <div className="page stack">
      <div className="hero">
        <h1>{strings.UI.appName}</h1>
        <p>{HOME.heroSub}</p>
      </div>

      <div className="quickplay">
        <div className="quickplay-row">
          <button
            className="btn btn-primary btn-quickplay"
            disabled={!ready}
            onClick={() => quickPlay()}
          >
            {HOME.quickPlay}
          </button>
          <button
            className="btn btn-ranked btn-quickplay"
            disabled={!ready}
            onClick={() => {
              // Ranked needs a registered account. Guests get a clear prompt to
              // sign in rather than a server rejection toast.
              if (!me || me.isGuest) {
                pushInfo(HOME.rankedSignInPrompt);
                return;
              }
              rankedPlay();
            }}
            title={!me || me.isGuest ? HOME.rankedSignInPrompt : HOME.rankedSub}
          >
            {HOME.ranked}
          </button>
        </div>
        <p className="quickplay-sub">{HOME.quickPlaySub}</p>
      </div>

      {me && <ProfilePanel />}

      <div className="grid-2">
        <AuthCard />
        <div className="stack">
          <JoinByCode />
          {authed && <CreateLobbyCard />}
        </div>
      </div>

      <LobbyBrowser onJoin={(id) => joinLobby({ lobbyId: id })} pushInfo={pushInfo} />

      <QuickPlayOverlay />
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
  if (!matchmaking) return null;
  const matched = matchmaking.state === 'matched';
  const ranked = matchmaking.mode === 'ranked';
  const searchTitle = ranked ? HOME.rankedSearching : HOME.quickPlaySearching;
  const searchSub = ranked ? HOME.rankedSearchingSub : HOME.quickPlaySearchingSub;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={searchTitle}>
      <div className="modal quickplay-modal">
        <div className="panel panel-pad">
          <div className="qp-spinner" aria-hidden="true" />
          <h2 className="qp-title">{matched ? HOME.quickPlayMatched : searchTitle}</h2>
          <p className="qp-sub">{matched ? '' : searchSub}</p>
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
      else await api.register(username, password, email || undefined);
      // Rebind the live WS session to the identity we just authenticated as,
      // so the chosen name/account actually takes effect (otherwise the socket
      // stays bound to its initial auto-minted guest).
      conn.reauth();
      // Pull the fresh account/stats so the profile card renders (goal 1).
      void refreshMe();
    } catch {
      setError(HOME.authError);
    } finally {
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
        <div>
          <label>{HOME.guestNameLabel}</label>
          <input
            value={guestName}
            maxLength={24}
            placeholder={HOME.newGuestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </div>
      )}

      {mode !== 'guest' && (
        <>
          <div>
            <label>{HOME.usernameLabel}</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label>{HOME.passwordLabel}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === 'register' && (
            <div>
              <label>{HOME.emailLabel}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
        </>
      )}

      {error && <div className="error-text">{error}</div>}

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
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          className="btn"
          disabled={code.length !== 6}
          onClick={() => navigate(`/join/${code}`)}
        >
          {strings.UI.joinByCode}
        </button>
      </div>
    </div>
  );
}

function CreateLobbyCard() {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<LobbyVisibility>('private');
  const [setupId, setSetupId] = useState(SETUPS[0]?.id ?? '');
  const [testMode, setTestMode] = useState(false);
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
      <div className="toggle">
        <span className="toggle-label">
          {HOME.testModeLabel} <TestBadge />
        </span>
        <Switch on={testMode} label={HOME.testModeLabel} onChange={setTestMode} />
      </div>
      {testMode && (
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
