/**
 * Own-seat panel (BUILD_SPEC §13.1): role card (name, faction, ability text from
 * shared role data, uses remaining), night-action target picker (legal targets,
 * changeable until deadline, cancel), day abilities (jailor jail-select, mayor
 * reveal w/ confirm), last-will editor (debounced autosave, 500 cap), death-note
 * editor when applicable.
 */

import { useEffect, useRef, useState } from 'react';
import {
  getRole,
  LAST_WILL_MAX,
  DEATH_NOTE_MAX,
  type AbilityInfo,
  type PublicSeat,
  type Phase,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { FactionTag } from './common.js';
import { GAME } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import {
  sendNightAction,
  sendDayAbility,
  sendLastWill,
  sendDeathNote,
} from '../ws/actions.js';

export function OwnPanel({
  seats,
  phase,
}: {
  seats: PublicSeat[];
  phase: Phase;
}) {
  const own = useStore((s) => s.own);
  const lastWillsEnabled = useStore((s) => s.lobby?.config.lastWillsEnabled ?? true);
  if (!own) return null;

  const def = getRole(own.role);
  const selfSeat = seats.find((s) => s.seat === own.seat);
  const alive = selfSeat?.alive ?? true;

  return (
    <div className="stack">
      <div className="role-card">
        <div className="spread">
          <span className="role-name">{def.name}</span>
          <FactionTag faction={def.faction} />
        </div>
        <div className="role-tagline">{def.tagline}</div>
        <div className="role-desc">{def.description}</div>
        <div style={{ marginTop: 10 }}>
          {own.abilities.map((a) => (
            <AbilityRow key={a.id} ability={a} />
          ))}
        </div>
        <div className="ability-row">
          <span className="muted">{GAME.winCondition}</span>
        </div>
        <div className="role-desc" style={{ marginTop: 0 }}>
          {def.winHint}
        </div>
        {own.mates && own.mates.length > 0 && (
          <div className="ability-row">
            <span className="muted">{GAME.mates}</span>
            <span>
              {own.mates
                .map((m) => sanitizeInline(seats.find((s) => s.seat === m)?.name ?? `#${m + 1}`))
                .join(', ')}
            </span>
          </div>
        )}
      </div>

      {alive && phase === 'NIGHT' && <NightAction own={own} seats={seats} />}
      {alive && (phase === 'DAY_0' || phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING') && (
        <DayAbilities own={own} seats={seats} phase={phase} />
      )}

      {lastWillsEnabled && alive && (
        <LastWillEditor
          title={GAME.lastWillTitle}
          value={own.lastWill}
          max={LAST_WILL_MAX}
          placeholder={GAME.lastWillPlaceholder}
          onSave={(t) => {
            useStore.getState().setLastWill(t);
            sendLastWill(t);
          }}
        />
      )}

      {alive && canKeepDeathNote(own.role) && (
        <LastWillEditor
          title={GAME.deathNoteTitle}
          value={own.deathNote}
          max={DEATH_NOTE_MAX}
          placeholder={GAME.deathNotePlaceholder}
          onSave={(t) => {
            useStore.getState().setDeathNote(t);
            sendDeathNote(t);
          }}
        />
      )}
    </div>
  );
}

function AbilityRow({ ability }: { ability: AbilityInfo }) {
  let uses: string;
  if (ability.timing === 'passive') uses = GAME.passive;
  else if (ability.usesRemaining === null) uses = GAME.unlimited;
  else uses = GAME.usesRemaining(ability.usesRemaining);
  return (
    <div className="ability-row">
      <span>{ability.name}</span>
      <span className="muted">{uses}</span>
    </div>
  );
}

function nightAbilityFor(own: ReturnType<typeof useStore.getState>['own']): AbilityInfo | null {
  if (!own) return null;
  return own.abilities.find((a) => a.timing === 'night') ?? null;
}

function NightAction({
  own,
  seats,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
}) {
  const ability = nightAbilityFor(own);
  if (!ability) {
    return (
      <div className="panel panel-pad">
        <span className="muted">{GAME.noNightAction}</span>
      </div>
    );
  }
  const def = getRole(own.role);
  // Legal targets: living seats, excluding self unless the role may self-target.
  const allowSelf = def.targetScope === 'others_or_self' || def.targetScope === 'self';
  const selfOnly = def.targetScope === 'self';
  const targets = seats.filter(
    (s) => s.alive && (selfOnly ? s.seat === own.seat : s.seat !== own.seat || allowSelf),
  );

  function choose(seat: number | null) {
    useStore.getState().setNightSelection(ability!.id, seat);
    sendNightAction(ability!.id, seat);
  }

  return (
    <div className="panel panel-pad stack">
      <div className="spread">
        <strong>{GAME.nightAction}</strong>
        <span className="muted">{ability.name}</span>
      </div>
      <div className="target-grid">
        {targets.map((t) => {
          const selected = own.nightTarget === t.seat;
          return (
            <button
              key={t.seat}
              className={`btn btn-sm target-opt ${selected ? 'btn-active' : ''}`}
              onClick={() => choose(selected ? null : t.seat)}
            >
              {t.seat + 1} · {sanitizeInline(t.name)}
              {t.seat === own.seat ? ' (you)' : ''}
            </button>
          );
        })}
      </div>
      {own.nightTarget !== null ? (
        <div className="spread">
          <span className="muted">
            {GAME.targetSet(
              sanitizeInline(seats.find((s) => s.seat === own.nightTarget)?.name ?? ''),
            )}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={() => choose(null)}>
            {GAME.cancelAction}
          </button>
        </div>
      ) : (
        <span className="faint">{GAME.actionLocked}</span>
      )}
    </div>
  );
}

function DayAbilities({
  own,
  seats,
  phase,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
  phase: Phase;
}) {
  const def = getRole(own.role);

  if (def.dayAction === 'jail' && phase !== 'DAY_0') {
    const targets = seats.filter((s) => s.alive && s.seat !== own.seat);
    return (
      <div className="panel panel-pad stack">
        <strong>{GAME.jailSelect}</strong>
        <div className="target-grid">
          {targets.map((t) => {
            const selected = own.jailTarget === t.seat;
            return (
              <button
                key={t.seat}
                className={`btn btn-sm target-opt ${selected ? 'btn-active' : ''}`}
                onClick={() => sendDayAbility('jail', t.seat)}
              >
                {t.seat + 1} · {sanitizeInline(t.name)}
              </button>
            );
          })}
        </div>
        {own.jailTarget !== null && (
          <span className="muted">
            {GAME.jailSet(
              sanitizeInline(seats.find((s) => s.seat === own.jailTarget)?.name ?? ''),
            )}
          </span>
        )}
      </div>
    );
  }

  if (def.dayAction === 'reveal') {
    return (
      <div className="panel panel-pad stack">
        {own.revealed ? (
          <span className="muted">{GAME.revealed}</span>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => {
              if (globalThis.confirm(GAME.revealConfirm)) sendDayAbility('reveal');
            }}
          >
            {GAME.reveal}
          </button>
        )}
      </div>
    );
  }

  return null;
}

function canKeepDeathNote(role: string): boolean {
  // The SK and the mafia faction killer maintain a death note (§6.4). The Forger
  // (batch A) uses the same death-note field to prepare the counterfeit will it
  // plants. We surface the editor to plausible holders; the server is
  // authoritative on acceptance.
  return (
    role === 'SERIAL_KILLER' ||
    role === 'MAFIOSO' ||
    role === 'GODFATHER' ||
    role === 'FORGER'
  );
}

/** Debounced autosave editor for last will / death note. */
function LastWillEditor({
  title,
  value,
  max,
  placeholder,
  onSave,
}: {
  title: string;
  value: string;
  max: number;
  placeholder: string;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(value);

  // Keep editor in sync if the server snapshot supplies a value (e.g. resume).
  useEffect(() => {
    if (value !== lastSentRef.current) {
      setText(value);
      lastSentRef.current = value;
    }
  }, [value]);

  function onChange(next: string) {
    setText(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSentRef.current = next;
      onSave(next);
      setSaved(true);
    }, 600);
  }

  return (
    <div className="panel panel-pad stack">
      <div className="spread">
        <strong>{title}</strong>
        <span className="faint">
          {saved ? GAME.lastWillSaved : GAME.lastWillSaving} · {text.length}/{max}
        </span>
      </div>
      <textarea
        rows={4}
        maxLength={max}
        value={text}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
