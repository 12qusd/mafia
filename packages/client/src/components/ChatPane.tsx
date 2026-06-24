/**
 * Chat pane (BUILD_SPEC §13.1): channel tabs shown contextually, message log
 * with click-name-to-whisper, input with `/w <seat> text` whisper syntax, and
 * public whisper-meta lines ("X whispers to Y"). All text is sanitized at the
 * source (reducer) and additionally profanity-masked / mute-filtered here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { type ChatChannel, JAILOR_CHAT_ALIAS } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { GAME } from '../lib/strings-extra.js';
import { parseChatInput, whisperPrefix } from '../lib/whisper.js';
import { maskProfanity } from '../lib/profanity.js';
import { sanitizeInline } from '../lib/sanitize.js';
import type { MuteReason } from '../lib/channels.js';

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  lobby: GAME.channelLobby,
  day: GAME.channelDay,
  mafia: GAME.channelMafia,
  triad: GAME.channelTriad,
  jail: GAME.channelJail,
  dead: GAME.channelDead,
  whisper: GAME.channelWhisper,
};

export interface ChatPaneProps {
  /** Channels the seat is entitled to (tabs rendered for these only). */
  channels: ChatChannel[];
  activeDefault: ChatChannel;
  /** Send a normal chat message in the given channel. */
  onSend: (channel: ChatChannel, text: string) => void;
  /** Send a whisper (game only); omitted in lobby. */
  onWhisper?: (toSeat: number, text: string) => void;
  /** Resolve a seat index to a display name. */
  seatNameFor: (seat: number) => string;
  /** Total seat count for whisper target validation (game only). */
  seatCount?: number;
  /**
   * Coarse gate: whether the local seat may type at all (used by the lobby,
   * which has a single channel). In-game, prefer `canSpeakInChannel` for the
   * per-tab decision; this stays as the fallback when that prop is absent.
   */
  canSpeak: boolean;
  /**
   * Per-channel speak gate (game only). When provided, the active tab's value
   * decides whether the input is enabled, so switching tabs re-evaluates the
   * voice (e.g. a living seat may speak in `day` but not in `dead`).
   */
  canSpeakInChannel?: (channel: ChatChannel) => boolean;
  /**
   * Why the local seat cannot speak in a channel (game only) — selects the
   * disabled-input copy. Returns null when the seat CAN speak there.
   */
  muteReasonFor?: (channel: ChatChannel) => MuteReason | null;
  /** Whisper-meta events to interleave in the day channel (game only). */
  showWhisperMeta?: boolean;
}

/** Context-aware copy for a disabled chat input (BUILD_SPEC §13.1). */
function mutedPlaceholder(reason: MuteReason): string {
  switch (reason) {
    case 'spectator':
      return GAME.chatMutedSpectator;
    case 'silenced':
      return GAME.chatSilenced;
    case 'dead':
      return GAME.chatDeadOnly;
    case 'phase':
    default:
      return GAME.chatMutedPhase;
  }
}

export function ChatPane(props: ChatPaneProps) {
  const {
    channels,
    activeDefault,
    onSend,
    onWhisper,
    seatNameFor,
    seatCount = 0,
    canSpeak,
    canSpeakInChannel,
    muteReasonFor,
  } = props;
  const allChat = useStore((s) => s.chat);
  const whisperMeta = useStore((s) => s.whisperMeta);
  const settings = useStore((s) => s.settings);
  // A roster name-click arms a whisper target here (cross-column hand-off, H6).
  const whisperArm = useStore((s) => s.whisperArm);
  const setWhisperArm = useStore((s) => s.setWhisperArm);

  const [active, setActive] = useState<ChatChannel>(activeDefault);
  const [text, setText] = useState('');
  const [whisperTarget, setWhisperTarget] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // If the active tab is no longer entitled, fall back.
  useEffect(() => {
    if (!channels.includes(active)) setActive(channels[0] ?? activeDefault);
  }, [channels, active, activeDefault]);

  const lines = useMemo(() => {
    const filtered = allChat.filter((l) => l.channel === active);
    return filtered;
  }, [allChat, active]);

  // Voice for the CURRENT tab: prefer the per-channel gate (game), falling back
  // to the coarse `canSpeak` (lobby). The placeholder reflects the real reason.
  const activeCanSpeak = canSpeakInChannel ? canSpeakInChannel(active) : canSpeak;
  const mutedReason = muteReasonFor ? muteReasonFor(active) : canSpeak ? null : 'spectator';
  const mutedText = mutedReason ? mutedPlaceholder(mutedReason) : GAME.chatMutedSpectator;

  // Auto-scroll to newest.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, active]);

  function display(raw: string): string {
    return maskProfanity(raw, settings.profanityFilter);
  }

  function submit() {
    const parsed = parseChatInput(text, seatCount || 99);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'error') {
      useStore.getState().pushInfo('That whisper command was not valid.');
      return;
    }
    if (parsed.kind === 'whisper') {
      if (onWhisper) onWhisper(parsed.toSeat, parsed.text);
      setText('');
      setWhisperTarget(null);
      return;
    }
    // Plain chat. If a click-to-whisper target is armed and no /w typed, whisper.
    if (whisperTarget !== null && onWhisper) {
      onWhisper(whisperTarget, parsed.text);
      setText('');
      setWhisperTarget(null);
      return;
    }
    onSend(active, parsed.text);
    setText('');
  }

  function armWhisper(seat: number) {
    if (!onWhisper) return;
    setWhisperTarget(seat);
    setText((t) => (t.startsWith('/w ') ? t : whisperPrefix(seat)));
    inputRef.current?.focus();
  }

  // Consume a roster-armed whisper target (set by a PlayerList name-click, H6).
  // Only honoured where whispers exist (`onWhisper` present, i.e. in-game); the
  // arm is cleared either way so a stale seat never lingers. Server-side rules
  // (day-phase, living↔living, whispersEnabled) still gate the actual send. The
  // arming is inlined (not via `armWhisper`) so the effect's deps stay honest.
  useEffect(() => {
    if (whisperArm === null) return;
    if (onWhisper) {
      setWhisperTarget(whisperArm);
      setText((t) => (t.startsWith('/w ') ? t : whisperPrefix(whisperArm)));
      inputRef.current?.focus();
    }
    setWhisperArm(null);
  }, [whisperArm, onWhisper, setWhisperArm]);

  return (
    <div className="chat-pane">
      {channels.length > 1 && (
        <div className="chat-tabs" role="tablist" aria-label={GAME.channelTabsLabel}>
          {channels.map((ch, i) => (
            <button
              key={ch}
              id={`chat-tab-${ch}`}
              role="tab"
              type="button"
              aria-selected={ch === active}
              aria-controls="chat-tabpanel"
              tabIndex={ch === active ? 0 : -1}
              className={`chat-tab ${ch === active ? 'active' : ''}`}
              onClick={() => setActive(ch)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const dir = e.key === 'ArrowRight' ? 1 : -1;
                  const next = channels[(i + dir + channels.length) % channels.length]!;
                  setActive(next);
                  // Move focus to the newly selected tab.
                  document.getElementById(`chat-tab-${next}`)?.focus();
                }
              }}
            >
              {CHANNEL_LABEL[ch]}
            </button>
          ))}
        </div>
      )}

      <div
        className="chat-log"
        ref={logRef}
        id="chat-tabpanel"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={GAME.chatLogLabel(CHANNEL_LABEL[active])}
      >
        {lines.length === 0 && <div className="faint">…</div>}
        {lines.map((l) => {
          const fromLabel =
            l.from === JAILOR_CHAT_ALIAS
              ? JAILOR_CHAT_ALIAS
              : sanitizeInline(seatNameFor(l.from));
          const isWhisper = l.channel === 'whisper';
          const canWhisperFrom = typeof l.from === 'number' && !!onWhisper;
          return (
            <div className={`chat-line ${isWhisper ? 'chat-whisper' : ''}`} key={l.id}>
              <button
                type="button"
                className="chat-from"
                disabled={!canWhisperFrom}
                aria-label={canWhisperFrom ? GAME.whisperTo(fromLabel) : undefined}
                onClick={() => typeof l.from === 'number' && armWhisper(l.from)}
              >
                {fromLabel}
                {isWhisper ? ' (whisper)' : ''}:
              </button>{' '}
              {display(l.text)}
            </div>
          );
        })}

        {/* Public whisper-meta interleaved when viewing the Day channel. */}
        {props.showWhisperMeta &&
          active === 'day' &&
          whisperMeta.map((w) => (
            <div className="chat-line chat-meta" key={`wm-${w.id}`}>
              {GAME.whisperMeta(
                sanitizeInline(seatNameFor(w.fromSeat)),
                sanitizeInline(seatNameFor(w.toSeat)),
              )}
            </div>
          ))}
      </div>

      {whisperTarget !== null && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="pill">{GAME.whisperingTo(sanitizeInline(seatNameFor(whisperTarget)))}</span>
          <button
            className="linkbtn"
            onClick={() => {
              setWhisperTarget(null);
              setText('');
            }}
          >
            {GAME.cancelWhisper}
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="grow"
          value={text}
          disabled={!activeCanSpeak}
          maxLength={256}
          placeholder={
            activeCanSpeak
              ? active === 'dead'
                ? GAME.chatPlaceholderDead
                : GAME.chatPlaceholder
              : mutedText
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          className="btn"
          disabled={!activeCanSpeak || text.trim().length === 0}
          onClick={submit}
        >
          Send
        </button>
      </div>
      {onWhisper && <div className="faint" style={{ fontSize: '0.78em', marginTop: 4 }}>{GAME.whisperHint}</div>}
    </div>
  );
}
