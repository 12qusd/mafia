/**
 * Lobby screen (BUILD_SPEC §13.1): roster with host/ready badges, setup summary
 * (role preview with faction colors + icons), config display (host-editable
 * within bounds), lobby chat, invite-link copy, host controls (kick / transfer
 * / start), spectator join.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  strings,
  getSetup,
  MIN_PLAYERS,
  DEFAULT_LOBBY_CONFIG,
  PHASE_TIMING_BOUNDS,
  type LobbyConfig,
  type TestBotPolicy,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { useLobbyNav } from '../components/useLobbyNav.js';
import { DecoHead, FactionTag, RoleChip, Switch, TestBadge } from '../components/common.js';
import { FactionIcon, IconCopy } from '../components/Icons.js';
import { LOBBY } from '../lib/strings-extra.js';
import { selfId, isHost } from '../lib/identity.js';
import { previewSlots } from '../lib/setup-preview.js';
import { sanitizeInline } from '../lib/sanitize.js';
import {
  startGame,
  kick,
  leaveLobby,
  setLobbyConfig,
  sendChat,
  testAddBots,
  testRemoveBot,
} from '../ws/actions.js';
import { ChatPane } from '../components/ChatPane.js';

export function LobbyScreen() {
  useLobbyNav();
  const navigate = useNavigate();
  const lobby = useStore((s) => s.lobby);
  const self = useStore((s) => selfId(s));

  const setup = useMemo(() => (lobby ? getSetup(lobby.setupId) : undefined), [lobby]);
  const host = isHost(lobby, self);

  if (!lobby) {
    return (
      <div className="page center" style={{ minHeight: '40vh' }}>
        <div className="panel panel-pad center stack" style={{ textAlign: 'center' }}>
          <h2>{LOBBY.waitingForHost}</h2>
          <p className="muted">Reaching the table…</p>
          <button className="btn" onClick={() => navigate('/')}>
            {strings.UI.leaveGame}
          </button>
        </div>
      </div>
    );
  }

  const players = lobby.members.filter((m) => !m.isSpectator);
  const canStart = host && players.length >= MIN_PLAYERS && lobby.status === 'waiting';

  return (
    <div className="page stack">
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>
            {sanitizeInline(lobby.name)} {lobby.testMode && <TestBadge />}
          </h1>
          <span className="muted">
            {setup?.name ?? lobby.setupId} · {players.length}{' '}
            {players.length === 1 ? 'player' : 'players'}
            {lobby.spectatorCount > 0 ? ` · ${LOBBY.spectatorsPresent(lobby.spectatorCount)}` : ''}
          </span>
        </div>
        <div className="row">
          <InviteCopy code={lobby.id} visibility={lobby.visibility} />
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              leaveLobby();
              navigate('/');
            }}
          >
            {LOBBY.leaveLobby}
          </button>
        </div>
      </div>

      <div className="lobby-grid">
        {/* Roster + chat */}
        <div className="stack">
          <div className="panel panel-pad">
            <DecoHead>{LOBBY.roster}</DecoHead>
            <div className="stack">
              {lobby.members.map((m) => {
                const isMe = m.userOrGuestId === self;
                return (
                  <div className="roster-item" key={m.userOrGuestId}>
                    <span className={`dot ${m.connected ? 'dot-on' : ''}`} />
                    <span className="grow">
                      {sanitizeInline(m.name)}{' '}
                      {m.isSpectator && <span className="badge">{LOBBY.spectatorBadge}</span>}
                    </span>
                    {m.isHost && <span className="badge badge-host">{LOBBY.hostBadge}</span>}
                    {isMe && <span className="badge badge-you">{LOBBY.youBadge}</span>}
                    {host && !isMe && lobby.status === 'waiting' && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => kick(m.userOrGuestId)}
                      >
                        {LOBBY.kick}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel panel-pad" style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
            <DecoHead>{LOBBY.lobbyChat}</DecoHead>
            <ChatPane
              channels={['lobby']}
              activeDefault="lobby"
              onSend={(_ch, text) => sendChat('lobby', text)}
              seatNameFor={(seat) =>
                sanitizeInline(lobby.members[seat]?.name ?? `#${seat + 1}`)
              }
              canSpeak
            />
          </div>
        </div>

        {/* Setup + config */}
        <div className="stack">
          <div className="panel panel-pad">
            <DecoHead>{LOBBY.setupSummary}</DecoHead>
            <strong>{setup?.name ?? lobby.setupId}</strong>
            {setup && <p className="muted" style={{ marginTop: 4 }}>{setup.description}</p>}
            <div className="row" style={{ gap: 12, margin: '8px 0' }}>
              <FactionTag faction="TOWN" />
              <FactionTag faction="MAFIA" />
              <FactionTag faction="NEUTRAL_KILLING" />
              <FactionTag faction="NEUTRAL_BENIGN" />
            </div>
            {setup && (
              <div className="setup-roles">
                {previewSlots(setup, Math.max(players.length, MIN_PLAYERS)).map((slot, i) =>
                  slot.kind === 'role' ? (
                    <RoleChip key={i} role={slot.role} />
                  ) : (
                    <span key={i} className={`role-chip faction-${slot.faction}`}>
                      <FactionIcon faction={slot.faction} />
                      {slot.label}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>

          <ConfigPanel
            host={host}
            config={lobby.config}
            onChange={(c) => setLobbyConfig(c)}
          />

          {host && lobby.testMode && lobby.status === 'waiting' && (
            <AiPlayersPanel
              botCount={players.filter((m) => m.name.startsWith('Bot ·')).length}
              tableSize={players.length}
            />
          )}

          <button className="btn btn-primary" disabled={!canStart} onClick={() => startGame()}>
            {strings.UI.startGame}
          </button>
          {host && players.length < MIN_PLAYERS && (
            <p className="muted">{LOBBY.needMorePlayers(MIN_PLAYERS)}</p>
          )}
          {!host && <p className="muted">{LOBBY.waitingForHost}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * TEST MODE only (host of a test lobby, pre-game): add or remove AI players to
 * fill the table without needing human seats. `add_bot`/`remove_bot` are
 * pre-game only; the server gates on testMode + host.
 */
function AiPlayersPanel({ botCount, tableSize }: { botCount: number; tableSize: number }) {
  const [count, setCount] = useState(6);
  const [policy, setPolicy] = useState<TestBotPolicy>('scripted');
  const room = Math.max(0, MIN_PLAYERS + 8 - tableSize); // setups cap at 15

  return (
    <div className="panel panel-pad stack">
      <DecoHead>
        AI players <TestBadge />
      </DecoHead>
      <p className="faint" style={{ fontSize: '0.8em' }}>
        Fill the table with bots so you can test the system. {botCount} bot
        {botCount === 1 ? '' : 's'} currently seated.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="number"
          min={1}
          max={Math.max(1, room)}
          value={count}
          style={{ width: 72 }}
          onChange={(e) =>
            setCount(Math.max(1, Math.min(14, Number(e.target.value) || 1)))
          }
        />
        <select value={policy} onChange={(e) => setPolicy(e.target.value as TestBotPolicy)}>
          <option value="scripted">Scripted (fast)</option>
          <option value="llm">AI / LLM</option>
        </select>
        <button className="btn btn-sm" onClick={() => testAddBots(count, policy)}>
          Add bots
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={botCount === 0}
          onClick={() => testRemoveBot('all')}
        >
          Remove all
        </button>
      </div>
    </div>
  );
}

function InviteCopy({ code, visibility }: { code: string; visibility: string }) {
  const [copied, setCopied] = useState(false);
  // Private lobbies route by invite code; here `code` is the lobby id used by
  // the /join route (the server maps invite codes to lobbies).
  const url = `${globalThis.location.origin}/join/${code}`;
  if (visibility !== 'private') {
    return <span className="pill">Public table</span>;
  }
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      title={url}
    >
      <IconCopy /> {copied ? LOBBY.copied : LOBBY.copyLink}
    </button>
  );
}

function ConfigPanel({
  host,
  config,
  onChange,
}: {
  host: boolean;
  config: LobbyConfig;
  onChange: (c: LobbyConfig) => void;
}) {
  const c = config;
  const whispers = c.whispersEnabled ?? DEFAULT_LOBBY_CONFIG.whispersEnabled;
  const deadSeeAll = c.deadSeeAll ?? DEFAULT_LOBBY_CONFIG.deadSeeAll;
  const lastWills = c.lastWillsEnabled ?? DEFAULT_LOBBY_CONFIG.lastWillsEnabled;
  const nightSecs: number = c.timings?.NIGHT ?? DEFAULT_LOBBY_CONFIG.timings.NIGHT ?? 60;
  const votingSecs: number = c.timings?.DAY_VOTING ?? DEFAULT_LOBBY_CONFIG.timings.DAY_VOTING ?? 150;

  function patch(p: Partial<LobbyConfig>) {
    onChange({ ...config, ...p });
  }

  return (
    <div className="panel panel-pad stack">
      <DecoHead>{LOBBY.config}</DecoHead>

      <div className="toggle">
        <span>{LOBBY.whispers}</span>
        {host ? (
          <Switch on={whispers} label={LOBBY.whispers} onChange={(v) => patch({ whispersEnabled: v })} />
        ) : (
          <span className="badge">{whispers ? LOBBY.on : LOBBY.off}</span>
        )}
      </div>
      <div className="toggle">
        <span>{LOBBY.deadSeeAll}</span>
        {host ? (
          <Switch on={deadSeeAll} label={LOBBY.deadSeeAll} onChange={(v) => patch({ deadSeeAll: v })} />
        ) : (
          <span className="badge">{deadSeeAll ? LOBBY.on : LOBBY.off}</span>
        )}
      </div>
      <div className="toggle">
        <span>{LOBBY.lastWills}</span>
        {host ? (
          <Switch on={lastWills} label={LOBBY.lastWills} onChange={(v) => patch({ lastWillsEnabled: v })} />
        ) : (
          <span className="badge">{lastWills ? LOBBY.on : LOBBY.off}</span>
        )}
      </div>

      {/* A representative tunable timing within bounds. */}
      <TimingRow
        host={host}
        label="Night"
        value={nightSecs}
        bounds={PHASE_TIMING_BOUNDS.NIGHT}
        onChange={(v) => patch({ timings: { ...c.timings, NIGHT: v } })}
      />
      <TimingRow
        host={host}
        label="Voting"
        value={votingSecs}
        bounds={PHASE_TIMING_BOUNDS.DAY_VOTING}
        onChange={(v) => patch({ timings: { ...c.timings, DAY_VOTING: v } })}
      />
    </div>
  );
}

function TimingRow({
  host,
  label,
  value,
  bounds,
  onChange,
}: {
  host: boolean;
  label: string;
  value: number;
  bounds: { min: number; max: number };
  onChange: (v: number) => void;
}) {
  return (
    <div className="toggle">
      <span>
        {label} <span className="faint">({bounds.min}–{bounds.max}s)</span>
      </span>
      {host ? (
        <input
          type="number"
          min={bounds.min}
          max={bounds.max}
          value={value}
          style={{ width: 80 }}
          onChange={(e) => {
            const n = Math.max(bounds.min, Math.min(bounds.max, Number(e.target.value) || bounds.min));
            onChange(n);
          }}
        />
      ) : (
        <span className="badge">{value}s</span>
      )}
    </div>
  );
}
