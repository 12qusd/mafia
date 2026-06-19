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
import { entitledChannels, canSpeakIn, muteReasonFor, type ChannelContext } from '../lib/channels.js';
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
import { AdminPanel } from '../components/AdminPanel.js';
import { AnimationStage } from '../components/AnimationStage.js';
import { TestBadge } from '../components/common.js';
import { sendChat, sendWhisper } from '../ws/actions.js';

export function GameScreen() {
  const navigate = useNavigate();
  const game = useStore((s) => s.game);
  const own = useStore((s) => s.own);
  const chat = useStore((s) => s.chat);
  const connection = useStore((s) => s.connection);
  const testMode = useStore((s) => s.lobby?.testMode ?? false);
  const isAdmin = useStore((s) => s.me?.isAdmin ?? false);
  const jailedThisNight = useStore((s) => s.jailedThisNight);
  const silencedToday = useStore((s) => s.silencedToday);

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
  const isTriad = own?.faction === 'TRIAD' || (own ? getRole(own.role).faction === 'TRIAD' : false);
  const isJailor = own?.role === 'JAILOR';

  // Single source of truth for the channel entitlements/speak gates (§6.4).
  const ctx: ChannelContext = {
    phase: game.phase,
    alive,
    spectator,
    isMafia,
    isTriad,
    isJailor,
    jailTarget: own?.jailTarget ?? null,
    jailedThisNight,
    silencedToday,
    chat,
  };

  const channels = entitledChannels(ctx);
  // Always offer at least the day channel; spectators read it.
  const tabChannels: ChatChannel[] = channels.length ? channels : ['day'];
  // Default to the most relevant tab for the current context: the cell for the
  // jailor/prisoner at night, the mafia/triad room for an evil seat at night,
  // otherwise the town day channel.
  const jailDefault =
    game.phase === 'NIGHT' &&
    alive &&
    ((isJailor && (own?.jailTarget ?? null) !== null) || jailedThisNight);
  const activeDefault: ChatChannel = jailDefault
    ? 'jail'
    : game.phase === 'NIGHT' && alive && isMafia
      ? 'mafia'
      : game.phase === 'NIGHT' && alive && isTriad
        ? 'triad'
        : 'day';

  // Can the local seat speak in the currently relevant context? The ChatPane
  // decides per-channel; we pass a coarse gate too.
  const speakAnywhere = tabChannels.some((ch) => canSpeakIn(ch, ctx));

  return (
    <>
      <AnimationStage />
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
            canSpeakInChannel={(ch) => canSpeakIn(ch, ctx)}
            muteReasonFor={(ch) => muteReasonFor(ch, ctx)}
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
          stumpedSeats={game.stumpedSeats}
          alive={alive}
          spectator={spectator}
          onWhisper={(seat) => {
            // Clicking a name in the roster arms a whisper. The ChatPane (left
            // column) reads `whisperArm`, switches to whisper-compose for that
            // seat, focuses its input, and clears the arm. Whispers are still
            // gated to living↔living day-phase by the server; an inert arm in a
            // disabled context simply does nothing on send.
            useStore.getState().setWhisperArm(seat);
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
      {isAdmin && <AdminPanel seats={game.seats} />}
    </>
  );
}
