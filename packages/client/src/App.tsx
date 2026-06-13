/**
 * App root + routing (BUILD_SPEC §13.1 routes: `/`, `/join/:code`, `/lobby/:id`,
 * `/game`, `/settings`). Opens the single WS connection on mount, applies
 * display settings to the document root, and renders the scene-tinted shell.
 */

import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { strings } from '@nocturne/shared';
import { conn } from './ws/connection.js';
import { useStore } from './store/store.js';
import { Toasts } from './components/Toasts.js';
import { ForceUpdateModal } from './components/ForceUpdateModal.js';
import { sceneForPhase } from './lib/scene.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { JoinScreen } from './screens/JoinScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';

export function App() {
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.game?.phase ?? null);

  // Open the connection once.
  useEffect(() => {
    conn.connect();
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
            <a className="linkbtn" href="/">
              Tables
            </a>
            <a className="linkbtn" href="/settings">
              Settings
            </a>
          </nav>
        </div>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/join/:code" element={<JoinScreen />} />
          <Route path="/lobby/:id" element={<LobbyScreen />} />
          <Route path="/game" element={<GameScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Toasts />
      <ForceUpdateModal />
    </div>
  );
}
