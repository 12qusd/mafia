/**
 * App root + routing (BUILD_SPEC §13.1 routes: `/`, `/join/:code`, `/lobby/:id`,
 * `/game`, `/settings`). Opens the single WS connection on mount, applies
 * display settings to the document root, and renders the scene-tinted shell.
 */

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { strings } from '@nocturne/shared';
import { conn } from './ws/connection.js';
import { useStore } from './store/store.js';
import { refreshMe } from './lib/me.js';
import { pingPresence } from './lib/api.js';
import { Toasts } from './components/Toasts.js';
import { ForceUpdateModal } from './components/ForceUpdateModal.js';
import { Glossary } from './components/Glossary.js';
import { GLOSSARY } from './lib/strings-extra.js';
import { sceneForPhase } from './lib/scene.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { JoinScreen } from './screens/JoinScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { PreferencesScreen } from './screens/PreferencesScreen.js';
import { LeaderboardScreen } from './screens/LeaderboardScreen.js';
import { SetupsScreen } from './screens/SetupsScreen.js';
import { ReplayScreen } from './screens/ReplayScreen.js';
import { CommunityScreen } from './screens/CommunityScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { FriendsScreen } from './screens/FriendsScreen.js';

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
  const location = useLocation();

  // Close the mobile drawer whenever the route changes (a nav tap navigated).
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

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
      <div className="app-shell">
        <div className="topbar">
          <span className="brand">{strings.UI.appName}</span>
          {/* Hamburger — mobile only (hidden on desktop via CSS). Toggles the
              nav drawer; on desktop the nav row is always shown inline. */}
          <button
            type="button"
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
          <nav id="topbar-nav" className={`topbar-nav row ${navOpen ? 'open' : ''}`}>
            <Link className="linkbtn" to="/">
              Tables
            </Link>
            <Link className="linkbtn" to="/leaderboard">
              Leaderboard
            </Link>
            <Link className="linkbtn" to="/community">
              Community
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
            <Link className="linkbtn" to="/preferences">
              Standing Orders
            </Link>
            <Link className="linkbtn" to="/settings">
              Settings
            </Link>
          </nav>
        </div>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/join/:code" element={<JoinScreen />} />
          <Route path="/lobby/:id" element={<LobbyScreen />} />
          <Route path="/game" element={<GameScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/community" element={<CommunityScreen />} />
          <Route path="/friends" element={<FriendsScreen />} />
          <Route path="/u/:username" element={<ProfileScreen />} />
          <Route path="/setups" element={<SetupsScreen />} />
          <Route path="/replay/:matchId" element={<ReplayScreen />} />
          <Route path="/preferences" element={<PreferencesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Toasts />
      <ForceUpdateModal />
      <Glossary open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
    </div>
  );
}
