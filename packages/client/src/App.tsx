/**
 * App root + routing (BUILD_SPEC §13.1 routes: `/`, `/join/:code`, `/lobby/:id`,
 * `/game`, `/settings`). Opens the single WS connection on mount, applies
 * display settings to the document root, and renders the scene-tinted shell.
 */

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { strings } from '@nocturne/shared';
import { conn } from './ws/connection.js';
import { useStore } from './store/store.js';
import { refreshMe } from './lib/me.js';
import { pingPresence } from './lib/api.js';
import { Toasts } from './components/Toasts.js';
import { ForceUpdateModal } from './components/ForceUpdateModal.js';
import { Glossary } from './components/Glossary.js';
import { RouteFallback } from './components/RouteFallback.js';
import { GLOSSARY, HOWTO, UI_A11Y } from './lib/strings-extra.js';
import { sceneForPhase } from './lib/scene.js';
// Eagerly bundled: the home/auth/lobby/game path is the first thing a visitor
// hits, so keep it in the initial chunk. Everything heavier or secondary is
// code-split below via React.lazy so it never weighs down the first paint.
import { HomeScreen } from './screens/HomeScreen.js';
import { JoinScreen } from './screens/JoinScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { VerifyEmailBanner } from './components/VerifyEmailBanner.js';

// Code-split, non-initial routes (BUILD_SPEC perf): each becomes its own chunk
// fetched on navigation, behind a noir <Suspense> fallback. The GameScreen path
// pulls in the heavy three.js StageCanvas (already lazy within AnimationStage),
// so the home/auth path stays light.
const HowToPlayScreen = lazy(() =>
  import('./screens/HowToPlayScreen.js').then((m) => ({ default: m.HowToPlayScreen })),
);
const PreferencesScreen = lazy(() =>
  import('./screens/PreferencesScreen.js').then((m) => ({ default: m.PreferencesScreen })),
);
const LeaderboardScreen = lazy(() =>
  import('./screens/LeaderboardScreen.js').then((m) => ({ default: m.LeaderboardScreen })),
);
const SetupsScreen = lazy(() =>
  import('./screens/SetupsScreen.js').then((m) => ({ default: m.SetupsScreen })),
);
const ReplayScreen = lazy(() =>
  import('./screens/ReplayScreen.js').then((m) => ({ default: m.ReplayScreen })),
);
const CommunityScreen = lazy(() =>
  import('./screens/CommunityScreen.js').then((m) => ({ default: m.CommunityScreen })),
);
const ForumIndexScreen = lazy(() =>
  import('./screens/ForumIndexScreen.js').then((m) => ({ default: m.ForumIndexScreen })),
);
const BoardScreen = lazy(() =>
  import('./screens/BoardScreen.js').then((m) => ({ default: m.BoardScreen })),
);
const ThreadScreen = lazy(() =>
  import('./screens/ThreadScreen.js').then((m) => ({ default: m.ThreadScreen })),
);
const ProfileScreen = lazy(() =>
  import('./screens/ProfileScreen.js').then((m) => ({ default: m.ProfileScreen })),
);
const FriendsScreen = lazy(() =>
  import('./screens/FriendsScreen.js').then((m) => ({ default: m.FriendsScreen })),
);
const ForgotPasswordScreen = lazy(() =>
  import('./screens/ForgotPasswordScreen.js').then((m) => ({ default: m.ForgotPasswordScreen })),
);
const ResetPasswordScreen = lazy(() =>
  import('./screens/ResetPasswordScreen.js').then((m) => ({ default: m.ResetPasswordScreen })),
);
const VerifyEmailScreen = lazy(() =>
  import('./screens/VerifyEmailScreen.js').then((m) => ({ default: m.VerifyEmailScreen })),
);

export function App() {
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.game?.phase ?? null);
  const meId = useStore((s) => (s.me && !s.me.isGuest ? s.me.id : null));
  // Public role glossary ("The Cast") — open from the topbar on every screen so
  // any player can read every role's canonical card (anti fake-verify, §13.1).
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // Mobile nav drawer (collapsed under the topbar on narrow screens). Hidden on
  // desktop entirely via CSS; the hamburger only appears at the mobile breakpoint.
  const [navOpen, setNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes (a nav tap navigated).
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Mobile nav drawer a11y: when open, Escape closes it + focus returns to the
  // hamburger, and focus moves to the first nav link on open. The drawer shares
  // its DOM with the desktop inline nav (shown via CSS), so we only manage focus
  // while it is actually open as a drawer — no trap that would hijack desktop.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false);
        navToggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const first = navRef.current?.querySelector<HTMLElement>('a, button');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Open the connection once, and bootstrap the signed-in identity (goal 4/8).
  useEffect(() => {
    conn.connect();
    void refreshMe();
    return () => conn.disconnect();
  }, []);

  // Presence heartbeat (Social): ping while a registered account is signed in.
  // The server throttles DB writes to ≥30s/user, so a 60s client cadence keeps
  // the "online" dots warm without churn. Guests have no presence row.
  useEffect(() => {
    if (!meId) return;
    void pingPresence();
    const t = setInterval(() => void pingPresence(), 60_000);
    return () => clearInterval(t);
  }, [meId]);

  // Apply display settings + scene tint to the document root.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset['colorblind'] = String(settings.colorblind);
    el.dataset['textscale'] = settings.textScale;
  }, [settings.colorblind, settings.textScale]);

  useEffect(() => {
    document.documentElement.dataset['scene'] = sceneForPhase(phase);
  }, [phase]);

  return (
    <div className="deco-bg">
      {/* Skip link — the first focusable element; visible on focus only. */}
      <a className="skip-link" href="#main">
        {UI_A11Y.skipToContent}
      </a>
      <div className="app-shell">
        <div className="topbar">
          <span className="brand">{strings.UI.appName}</span>
          {/* Hamburger — mobile only (hidden on desktop via CSS). Toggles the
              nav drawer; on desktop the nav row is always shown inline. */}
          <button
            type="button"
            ref={navToggleRef}
            className="nav-toggle"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            aria-controls="topbar-nav"
            onClick={() => setNavOpen((v) => !v)}
          >
            <span className="nav-toggle-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <nav
            id="topbar-nav"
            ref={navRef}
            aria-label={UI_A11Y.primaryNav}
            className={`topbar-nav row ${navOpen ? 'open' : ''}`}
          >
            <Link className="linkbtn" to="/">
              Tables
            </Link>
            <Link className="linkbtn" to="/leaderboard">
              Leaderboard
            </Link>
            <Link className="linkbtn" to="/community">
              Community
            </Link>
            <Link className="linkbtn" to="/forum">
              Forums
            </Link>
            <Link className="linkbtn" to="/friends">
              Friends
            </Link>
            <Link className="linkbtn" to="/setups">
              Setups
            </Link>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                setGlossaryOpen(true);
                setNavOpen(false);
              }}
              title={GLOSSARY.openTitle}
            >
              {GLOSSARY.open}
            </button>
            <Link className="linkbtn" to="/how-to-play">
              {HOWTO.topbarLink}
            </Link>
            <Link className="linkbtn" to="/preferences">
              Standing Orders
            </Link>
            <Link className="linkbtn" to="/settings">
              Settings
            </Link>
          </nav>
        </div>
        <VerifyEmailBanner />
        <main id="main">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/how-to-play" element={<HowToPlayScreen />} />
          <Route path="/join/:code" element={<JoinScreen />} />
          <Route path="/lobby/:id" element={<LobbyScreen />} />
          <Route path="/game" element={<GameScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/community" element={<CommunityScreen />} />
          <Route path="/forum" element={<ForumIndexScreen />} />
          <Route path="/forum/thread/:id" element={<ThreadScreen />} />
          <Route path="/forum/:boardSlug" element={<BoardScreen />} />
          <Route path="/friends" element={<FriendsScreen />} />
          <Route path="/forgot" element={<ForgotPasswordScreen />} />
          <Route path="/reset" element={<ResetPasswordScreen />} />
          <Route path="/verify-email" element={<VerifyEmailScreen />} />
          <Route path="/u/:username" element={<ProfileScreen />} />
          <Route path="/setups" element={<SetupsScreen />} />
          <Route path="/replay/:matchId" element={<ReplayScreen />} />
          <Route path="/preferences" element={<PreferencesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <Toasts />
      <ForceUpdateModal />
      <Glossary open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
    </div>
  );
}
