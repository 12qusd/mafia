/**
 * App root + routing (BUILD_SPEC §13.1 routes: `/`, `/join/:code`, `/lobby/:id`,
 * `/game`, `/settings`). Opens the single WS connection on mount, applies
 * display settings to the document root, and renders the scene-tinted shell.
 */

import { useEffect } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { strings } from '@nocturne/shared';
import { conn } from './ws/connection.js';
import { useStore } from './store/store.js';
import { refreshMe } from './lib/me.js';
import { Toasts } from './components/Toasts.js';
import { ForceUpdateModal } from './components/ForceUpdateModal.js';
import { sceneForPhase } from './lib/scene.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { JoinScreen } from './screens/JoinScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { LeaderboardScreen } from './screens/LeaderboardScreen.js';
import { SetupsScreen } from './screens/SetupsScreen.js';
import { ReplayScreen } from './screens/ReplayScreen.js';

export function App() {
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.game?.phase ?? null);

  // Open the connection once, and bootstrap the signed-in identity (goal 4/8).
  useEffect(() => {
    conn.connect();
    void refreshMe();
    return () => conn.disconnect();
  }, []);

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
          <nav className="row">
            <Link className="linkbtn" to="/">
              Tables
            </Link>
            <Link className="linkbtn" to="/leaderboard">
              Leaderboard
            </Link>
            <Link className="linkbtn" to="/setups">
              Setups
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
          <Route path="/setups" element={<SetupsScreen />} />
          <Route path="/replay/:matchId" element={<ReplayScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Toasts />
      <ForceUpdateModal />
    </div>
  );
}
