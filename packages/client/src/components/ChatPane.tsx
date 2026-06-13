/**
 * Chat pane (BUILD_SPEC §13.1): channel tabs shown contextually, message log
 * with click-name-to-whisper, input with `/w <seat> text` whisper syntax, and
 * public whisper-meta lines ("X whispers to Y"). All text is sanitized at the
 * source (reducer) and additionally profanity-masked / mute-filtered here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { type ChatChannel } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { GAME } from '../lib/strings-extra.js';
import { parseChatInput, whisperPrefix } from '../lib/whisper.js';
import { maskProfanity } from '../lib/profanity.js';
import { sanitizeInline } from '../lib/sanitize.js';

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  lobby: GAME.channelLobby,
  day: GAME.channelDay,
  mafia: GAME.channelMafia,
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
  /** Whether the local seat may type at all. */
  canSpeak: boolean;
  /** Whisper-meta events to interleave in the day channel (game only). */
  showWhisperMeta?: boolean;
}

export function ChatPane(props: ChatPaneProps) {
  const { channels, activeDefault, onSend, onWhisper, seatNameFor, seatCount = 0, canSpeak } =
    props;
  const allChat = useStore((s) => s.chat);
  const whisperMeta = useStore((s) => s.whisperMeta);
  const settings = useStore((s) => s.settings);

  const [active, setActive] = useState<ChatChannel>(activeDefault);
  const [text, setText] = useState('');
  const [whisperTarget, setWhisperTarget] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // If the active tab is no longer entitled, fall back.
  useEffect(() => {
    if (!channels.includes(active)) setActive(channels[0] ?? activeDefault);
  }, [channels, active, activeDefault]);

  const lines = useMemo(() => {
    const filtered = allChat.filter((l) => l.channel === active);
    return filtered;
  }, [allChat, active]);

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
  }

  return (
    <div className="chat-pane">
      {channels.length > 1 && (
        <div className="chat-tabs">
          {channels.map((ch) => (
            <button
              key={ch}
              className={`chat-tab ${ch === active ? 'active' : ''}`}
              onClick={() => setActive(ch)}
            >
              {CHANNEL_LABEL[ch]}
            </button>
          ))}
        </div>
      )}

      <div className="chat-log" ref={logRef}>
        {lines.length === 0 && <div className="faint">…</div>}
        {lines.map((l) => {
          const fromLabel =
            l.from === 'Jailor' ? 'Jailor' : sanitizeInline(seatNameFor(l.from));
          const isWhisper = l.channel === 'whisper';
          return (
            <div className={`chat-line ${isWhisper ? 'chat-whisper' : ''}`} key={l.id}>
              <span
                className="chat-from"
                onClick={() => typeof l.from === 'number' && armWhisper(l.from)}
              >
                {fromLabel}
                {isWhisper ? ' (whisper)' : ''}:
              </span>{' '}
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
          className="grow"
          value={text}
          disabled={!canSpeak}
          maxLength={256}
          placeholder={canSpeak ? GAME.chatPlaceholder : GAME.chatMutedSpectator}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button className="btn" disabled={!canSpeak || text.trim().length === 0} onClick={submit}>
          Send
        </button>
      </div>
      {onWhisper && <div className="faint" style={{ fontSize: '0.78em', marginTop: 4 }}>{GAME.whisperHint}</div>}
    </div>
  );
}
