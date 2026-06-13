/**
 * Game screen (BUILD_SPEC §13.1) — the heart of the product. Three columns:
 * left = chat (contextual channel tabs + whisper input), middle = phase banner +
 * own panel (role card, night action, day abilities, wills/notes) + private log,
 * right = player list (votes, tallies, badges). Plus trial overlay, paced dawn
 * death feed, and the game-over modal.
 *
 * Handles spectator (read-only), dead (dead chat + reveal), and reconnect states
 * (§13 resilience).
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRole, type ChatChannel } from '@nocturne/shared';
import { strings } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { entitledChannels, canSpeakIn } from '../lib/channels.js';
import { GAME } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { PhaseBanner } from '../components/PhaseBanner.js';
import { PlayerList } from '../components/PlayerList.js';
import { OwnPanel } from '../components/OwnPanel.js';
import { ChatPane } from '../components/ChatPane.js';
import { TrialOverlay } from '../components/TrialOverlay.js';
import { DeathFeed } from '../components/DeathFeed.js';
import { GameOver } from '../components/GameOver.js';
import { PrivateLog } from '../components/PrivateLog.js';
import { DirectorGate } from '../components/DirectorPanel.js';
import { TestBadge } from '../components/common.js';
import { sendChat, sendWhisper } from '../ws/actions.js';

export function GameScreen() {
  const navigate = useNavigate();
  const game = useStore((s) => s.game);
  const own = useStore((s) => s.own);
  const chat = useStore((s) => s.chat);
  const connection = useStore((s) => s.connection);
  const testMode = useStore((s) => s.lobby?.testMode ?? false);

  const seatNameFor = useMemo(
    () => (seat: number) =>
      sanitizeInline(game?.seats.find((s) => s.seat === seat)?.name ?? `#${seat + 1}`),
    [game?.seats],
  );

  if (!game) {
    return (
      <div className="page center" style={{ minHeight: '40vh' }}>
        <div className="panel panel-pad center stack" style={{ textAlign: 'center' }}>
          <h2>{connection === 'open' ? GAME.connecting : GAME.reconnecting}</h2>
          <button className="btn" onClick={() => navigate('/')}>
            {strings.UI.leaveGame}
          </button>
        </div>
      </div>
    );
  }

  const ownSeatPublic = own ? game.seats.find((s) => s.seat === own.seat) : undefined;
  const alive = ownSeatPublic?.alive ?? false;
  const spectator = game.spectator || !own;
  const isMafia = own?.faction === 'MAFIA' || (own ? getRole(own.role).faction === 'MAFIA' : false);

  const channels = entitledChannels({
    phase: game.phase,
    alive,
    spectator,
    isMafia,
    chat,
  });
  // Always offer at least the day channel; spectators read it.
  const tabChannels: ChatChannel[] = channels.length ? channels : ['day'];
  const activeDefault: ChatChannel = game.phase === 'NIGHT' && isMafia && alive ? 'mafia' : 'day';

  // Can the local seat speak in the currently relevant context? The ChatPane
  // decides per-channel; we pass a coarse gate too.
  const speakAnywhere = tabChannels.some((ch) =>
    canSpeakIn(ch, { phase: game.phase, alive, spectator, isMafia, chat }),
  );

  return (
    <>
      {testMode && (
        <div className="row" style={{ margin: '4px 8px 0', justifyContent: 'flex-end' }}>
          <TestBadge />
        </div>
      )}
      {connection !== 'open' && (
        <div className="panel panel-pad" style={{ margin: 8, textAlign: 'center' }}>
          <span className="muted">{GAME.reconnecting}</span>
        </div>
      )}
      <div className="game-shell">
        {/* Left: chat */}
        <div className="game-col panel panel-pad" style={{ overflow: 'hidden' }}>
          {spectator && <div className="pill" style={{ marginBottom: 8 }}>{GAME.spectating}</div>}
          <ChatPane
            channels={tabChannels}
            activeDefault={activeDefault}
            seatCount={game.seats.length}
            seatNameFor={seatNameFor}
            canSpeak={speakAnywhere}
            showWhisperMeta
            onSend={(ch, text) => sendChat(ch, text)}
            onWhisper={(toSeat, text) => sendWhisper(toSeat, text)}
          />
        </div>

        {/* Middle: phase banner + own panel + private log */}
        <div className="game-col" style={{ overflowY: 'auto' }}>
          <PhaseBanner phase={game.phase} dayNumber={game.dayNumber} endsAt={game.endsAt} />
          {own && !spectator ? (
            <OwnPanel seats={game.seats} phase={game.phase} />
          ) : (
            <div className="panel panel-pad">
              <span className="muted">{GAME.spectating}</span>
            </div>
          )}
          <PrivateLog seatNameFor={seatNameFor} />
        </div>

        {/* Right: player list */}
        <PlayerList
          seats={game.seats}
          phase={game.phase}
          ownSeat={own?.seat ?? null}
          accusedSeat={game.accusedSeat}
          tallies={game.tallies}
          votesBySeat={game.votesBySeat}
          alive={alive}
          spectator={spectator}
          onWhisper={(seat) => {
            // Clicking a name in the list arms a whisper via the chat input;
            // surfaced as info since the input lives in the other column.
            useStore.getState().pushInfo(GAME.whisperingTo(seatNameFor(seat)));
          }}
        />
      </div>

      <TrialOverlay
        phase={game.phase}
        accusedSeat={game.accusedSeat}
        endsAt={game.endsAt}
        seats={game.seats}
        ownSeat={own?.seat ?? null}
        alive={alive}
        spectator={spectator}
        lastVerdict={game.lastVerdict}
      />

      <DeathFeed seatNameFor={seatNameFor} />
      <GameOver />
      <DirectorGate />
    </>
  );
}
