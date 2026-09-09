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
import { FactionIcon } from './Icons.js';
import { FactionTag } from './common.js';
import { GAME } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { sendNightAction, sendDayAbility, sendLastWill, sendDeathNote } from '../ws/actions.js';

export function OwnPanel({ seats, phase }: { seats: PublicSeat[]; phase: Phase }) {
  const own = useStore((s) => s.own);
  const lastWillsEnabled = useStore((s) => s.lobby?.config.lastWillsEnabled ?? true);
  if (!own) return null;

  const def = getRole(own.role);
  const selfSeat = seats.find((s) => s.seat === own.seat);
  const alive = selfSeat?.alive ?? true;

  return (
    <div className="stack">
      <div className={`role-card role-card-${def.faction}`}>
        <div className="role-emblem" aria-hidden="true">
          <FactionIcon faction={def.faction} />
        </div>
        <div className="eyebrow">Your secret identity</div>
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
        {/* gap A11: an Executioner's MARK / Guardian Angel's CHARGE — the seat
            this role is privately bound to. Shown prominently on the card. */}
        {own.assignedTarget !== null && (
          <div className="ability-row">
            <span className="muted">
              {own.role === 'EXECUTIONER'
                ? GAME.yourMark(boundLabel(seats, own.assignedTarget))
                : own.role === 'GUARDIAN_ANGEL'
                  ? GAME.yourCharge(boundLabel(seats, own.assignedTarget))
                  : GAME.boundTo(boundLabel(seats, own.assignedTarget))}
            </span>
          </div>
        )}
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

/**
 * Self-toggle night abilities that the engine ACTIVATES on a `null`-target
 * submission (it does NOT treat their null as a cancel). Mirrors the allow-list
 * in `engine/src/apply.ts#handleNightAction`. For these, `sendNightAction(id,
 * null)` arms the toggle for the night; there is NO un-toggle frame (a second
 * null would merely re-arm), so standing down means submitting a DIFFERENT
 * ability or simply leaving it armed.
 */
const SELF_TOGGLE_IDS = new Set(['vest', 'alert', 'spy', 'ignite', 'divine']);

/** A bound-target (mark/charge) seat's display label. */
function boundLabel(seats: PublicSeat[], seat: number): string {
  return `${seat + 1} · ${sanitizeInline(seats.find((s) => s.seat === seat)?.name ?? `#${seat + 1}`)}`;
}

/**
 * Night-action area. Iterates the seat's REAL night abilities (gaps A1/A10: a
 * role may have MORE than one — e.g. the Arsonist's `douse` picker + `ignite`
 * toggle) and renders the correct control PER ability from its `targetDomain`
 * and id. Replaces the old single-ability `nightAbilityFor` + living-only grid.
 */
function NightAction({
  own,
  seats,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
}) {
  const nightAbilities = own.abilities.filter((a) => a.timing === 'night');
  if (nightAbilities.length === 0) {
    return (
      <div className="panel panel-pad">
        <span className="muted">{GAME.noNightAction}</span>
      </div>
    );
  }

  // gap A2/C4: the Jailor never gets a free target grid at night. Their only
  // night move is to execute (or spare) the prisoner jailed during the day.
  if (own.role === 'JAILOR') {
    const exec = nightAbilities.find((a) => a.id === 'kill_jailor') ?? null;
    return <JailorCell own={own} seats={seats} exec={exec} />;
  }

  // Two-target night actions share one picker (first target = `target`, second =
  // `target2`). The Witch's `witch_control` seizes a PUPPET and steers it onto a
  // VICTIM; the Transporter's `transport` swaps two HOUSES. Only the labels differ.
  const twoTarget = nightAbilities.find((a) => a.id === 'witch_control' || a.id === 'transport');
  if (twoTarget) {
    const labels =
      twoTarget.id === 'transport'
        ? {
            first: GAME.transportFirst,
            second: GAME.transportSecond,
            firstSet: GAME.transportFirstSet,
            secondSet: GAME.transportSecondSet,
            secondPending: GAME.transportSecondPending,
            needFirst: GAME.transportNeedFirst,
          }
        : {
            first: GAME.witchPuppet,
            second: GAME.witchVictim,
            firstSet: GAME.witchPuppetSet,
            secondSet: GAME.witchVictimSet,
            secondPending: GAME.witchVictimPending,
            needFirst: GAME.witchNeedPuppet,
          };
    return <TwoTargetAction own={own} seats={seats} ability={twoTarget} labels={labels} />;
  }

  // gap A1/A10: one control PER night ability. Submitting any one of them sets
  // the night intent (last submission wins — they are mutually exclusive per
  // night), so each control reflects whether it is the currently-selected one.
  return (
    <div className="panel panel-pad stack">
      {nightAbilities.map((ability) => (
        <AbilityControl key={ability.id} own={own} seats={seats} ability={ability} />
      ))}
    </div>
  );
}

/**
 * One night ability's control, chosen by `targetDomain`/id:
 *  - self/none toggles (alert, vest, ignite, spy, divine) → an ON/OFF arm button;
 *  - the Guardian Angel's `shield` → a single button bound to the CHARGE;
 *  - `dead`-domain abilities (autopsy, remember, disguise) → a grid of
 *    DEAD seats;
 *  - everything else → the standard living-seat grid.
 */
function AbilityControl({
  own,
  seats,
  ability,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
  ability: AbilityInfo;
}) {
  const selectedHere = own.nightAbility === ability.id;
  const usesLabel =
    ability.usesRemaining === null ? null : GAME.usesRemaining(ability.usesRemaining);

  function choose(seat: number | null) {
    useStore.getState().setNightSelection(ability.id, seat);
    sendNightAction(ability.id, seat);
  }

  // gap A3/A4/H5: self/none toggles render an explicit ON/OFF button, NOT a grid.
  if (
    SELF_TOGGLE_IDS.has(ability.id) ||
    ability.targetDomain === 'self' ||
    ability.targetDomain === 'none'
  ) {
    const armed = selectedHere;
    return (
      <div className="stack" style={{ gap: 4 }}>
        <div className="spread">
          <strong>{GAME.tonightVerb(ability.verb)}</strong>
          {usesLabel && <span className="muted">{usesLabel}</span>}
        </div>
        <button
          className={`btn btn-sm ${armed ? 'btn-active' : ''}`}
          // Arming sends a null-target submission, which the engine ACTIVATES for
          // these ids (it does NOT treat null as a cancel). There is no un-toggle
          // frame, so we only ARM here; standing down means choosing another move.
          onClick={() => {
            if (armed) return;
            choose(null);
          }}
        >
          {armed
            ? `${ability.verb} ✓`
            : `${GAME.selfToggleArm(ability.verb)}${usesLabel ? ` (${usesLabel})` : ''}`}
        </button>
        {armed ? (
          <span className="faint">
            {GAME.selfToggleArmed(ability.verb)} {GAME.selfToggleNote}
          </span>
        ) : (
          <span className="faint">{GAME.selfToggleNote}</span>
        )}
      </div>
    );
  }

  // gap H2: the Guardian Angel's `shield` is restricted to its CHARGE.
  if (ability.id === 'shield' && own.assignedTarget !== null) {
    const charge = own.assignedTarget;
    const armed = selectedHere && own.nightTarget === charge;
    return (
      <div className="stack" style={{ gap: 4 }}>
        <div className="spread">
          <strong>{GAME.tonightVerb(ability.verb)}</strong>
          {usesLabel && <span className="muted">{usesLabel}</span>}
        </div>
        <span className="faint">{GAME.yourCharge(boundLabel(seats, charge))}</span>
        <button
          className={`btn btn-sm ${armed ? 'btn-active' : ''}`}
          onClick={() => choose(armed ? null : charge)}
        >
          {GAME.shieldCharge(boundLabel(seats, charge))}
        </button>
        {armed && <span className="muted">{GAME.chargeShielded(boundLabel(seats, charge))}</span>}
      </div>
    );
  }

  // gap A7/A8/A9: dead-grave targets — the grid lists DEAD seats, not living.
  if (ability.targetDomain === 'dead') {
    return <DeadTargetGrid own={own} seats={seats} ability={ability} choose={choose} />;
  }

  // Default: the living-seat grid (Doctor heal, Sheriff check, Vigilante shoot…).
  const def = getRole(own.role);
  // The Arsonist's role scope is `others_or_self` for its IGNITE (stay home), but
  // that is a separate self-toggle; its `douse` may NOT target self (the engine
  // rejects a self-douse), so never offer the actor in the douse grid.
  const allowSelf =
    ability.id !== 'douse' && (def.targetScope === 'others_or_self' || def.targetScope === 'self');
  const selfOnly = def.targetScope === 'self';
  const targets = seats.filter((s) => {
    if (!s.alive) return false;
    if (ability.targetDomain === 'living_or_dead') return true;
    return selfOnly ? s.seat === own.seat : s.seat !== own.seat || allowSelf;
  });

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread">
        <strong>{GAME.tonightVerb(ability.verb)}</strong>
        <span className="muted">{ability.name}</span>
      </div>
      <div className="target-grid" role="group" aria-label={ability.verb}>
        {targets.map((t) => {
          const selected = selectedHere && own.nightTarget === t.seat;
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
      {selectedHere && own.nightTarget !== null ? (
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

/**
 * gap A7/A8: a grid of DEAD seats for grave-targeting abilities
 * (autopsy/remember/disguise). Lists any dead seat.
 */
function DeadTargetGrid({
  own,
  seats,
  ability,
  choose,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
  ability: AbilityInfo;
  choose: (seat: number | null) => void;
}) {
  const targets = seats.filter((s) => !s.alive);
  const selectedHere = own.nightAbility === ability.id;

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread">
        <strong>{GAME.tonightVerb(ability.verb)}</strong>
        <span className="muted">{ability.name}</span>
      </div>
      {targets.length === 0 ? (
        <span className="faint">{GAME.noDeadTargets}</span>
      ) : (
        <>
          <span className="faint">{GAME.deadTargetPrompt(ability.verb)}</span>
          <div className="target-grid" role="group" aria-label={ability.verb}>
            {targets.map((t) => {
              const selected = selectedHere && own.nightTarget === t.seat;
              const revealed = t.role ? ` · ${getRole(t.role).name}` : '';
              return (
                <button
                  key={t.seat}
                  className={`btn btn-sm target-opt ${selected ? 'btn-active' : ''}`}
                  onClick={() => choose(selected ? null : t.seat)}
                >
                  {t.seat + 1} · {sanitizeInline(t.name)}
                  {revealed}
                </button>
              );
            })}
          </div>
        </>
      )}
      {selectedHere && own.nightTarget !== null && (
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
      )}
    </div>
  );
}

/**
 * gap A2/C4: the Jailor's NIGHT panel. No free target grid — only the cell. If a
 * prisoner was jailed during the day (`own.jailTarget`), offer "Execute {name}"
 * (`sendNightAction('kill_jailor', prisoner)`) and "Spare" (a cancel: the engine
 * treats a null-target `kill_jailor` as a cancellation, which is exactly the
 * spare). If no one is jailed, the Jailor cannot execute tonight.
 */
function JailorCell({
  own,
  seats,
  exec,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
  exec: AbilityInfo | null;
}) {
  const prisoner = own.jailTarget;
  const executionsLeft = exec?.usesRemaining ?? null;
  const noExecutions = executionsLeft !== null && executionsLeft <= 0;
  const willExecute = own.nightAbility === 'kill_jailor' && own.nightTarget === prisoner;

  return (
    <div className="panel panel-pad stack">
      <div className="spread">
        <strong>{GAME.cellTitle}</strong>
        {executionsLeft !== null && (
          <span className="muted">{GAME.executionsLeft(executionsLeft)}</span>
        )}
      </div>
      {prisoner === null ? (
        <span className="muted">{GAME.cellNoPrisoner}</span>
      ) : (
        <>
          <span className="muted">{GAME.cellPrisoner(boundLabel(seats, prisoner))}</span>
          {noExecutions ? (
            <span className="faint">{GAME.executionsSpent}</span>
          ) : (
            <div className="spread">
              <button
                className={`btn btn-sm ${willExecute ? 'btn-active' : 'btn-danger'}`}
                onClick={() => {
                  useStore.getState().setNightSelection('kill_jailor', prisoner);
                  sendNightAction('kill_jailor', prisoner);
                }}
              >
                {GAME.cellExecute(boundLabel(seats, prisoner))}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  // Spare: a null-target kill_jailor is a cancel in the engine.
                  useStore.getState().setNightSelection(null, null);
                  sendNightAction('kill_jailor', null);
                }}
              >
                {GAME.cellSpare}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Label set for the generic two-target picker (Witch control / Transporter swap). */
interface TwoTargetLabels {
  first: string;
  second: string;
  firstSet: (label: string) => string;
  secondSet: (label: string) => string;
  secondPending: string;
  needFirst: string;
}

/**
 * Generic two-target night action: a picker for the two abilities that carry a
 * `target` AND a `target2`. The first picker chooses the FIRST target and the
 * second the SECOND; both must be living seats other than the actor, and the two
 * must differ (the engine is authoritative on legality — this only guides). The
 * action is submitted only once BOTH are chosen, carrying `target` + `target2`.
 *
 * Used by the Witch (`witch_control`: puppet → victim) and the Transporter
 * (`transport`: house ↔ house). Only the `labels` differ.
 */
function TwoTargetAction({
  own,
  seats,
  ability,
  labels,
}: {
  own: NonNullable<ReturnType<typeof useStore.getState>['own']>;
  seats: PublicSeat[];
  ability: AbilityInfo;
  labels: TwoTargetLabels;
}) {
  const puppet = own.nightTarget;
  const victim = own.nightTarget2;
  // The actor never targets itself; living seats only.
  const living = seats.filter((s) => s.alive && s.seat !== own.seat);

  function submit(p: number | null, v: number | null) {
    // Persist locally first (pending UI state), then push to the server only
    // once we have a complete pair (puppet + victim). A bare puppet is cancelled.
    useStore.getState().setNightSelection(ability.id, p);
    useStore.getState().setNightSelection2(v);
    if (p !== null && v !== null) sendNightAction(ability.id, p, v);
    else sendNightAction(ability.id, null);
  }

  function choosePuppet(seat: number) {
    const next = puppet === seat ? null : seat;
    // Dropping the puppet drops the victim too; re-picking the seat now held as
    // victim is disallowed by clearing it.
    submit(next, next === victim ? null : victim);
  }
  function chooseVictim(seat: number) {
    const next = victim === seat ? null : seat;
    submit(puppet, next);
  }

  const seatName = (seat: number | null) =>
    sanitizeInline(seats.find((s) => s.seat === seat)?.name ?? '');

  return (
    <div className="panel panel-pad stack">
      <div className="spread">
        <strong>{GAME.nightAction}</strong>
        <span className="muted">{ability.name}</span>
      </div>

      {/* First target. */}
      <div className="stack" style={{ gap: 4 }}>
        <span className="faint">{labels.first}</span>
        <div className="target-grid" role="group" aria-label={labels.first}>
          {living.map((t) => {
            const selected = puppet === t.seat;
            return (
              <button
                key={t.seat}
                className={`btn btn-sm target-opt ${selected ? 'btn-active' : ''}`}
                onClick={() => choosePuppet(t.seat)}
              >
                {t.seat + 1} · {sanitizeInline(t.name)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Second target (a different living seat than the first). */}
      <div className="stack" style={{ gap: 4 }}>
        <span className="faint">{labels.second}</span>
        {puppet === null ? (
          <span className="faint">{labels.needFirst}</span>
        ) : (
          <div className="target-grid" role="group" aria-label={labels.second}>
            {living
              .filter((t) => t.seat !== puppet)
              .map((t) => {
                const selected = victim === t.seat;
                return (
                  <button
                    key={t.seat}
                    className={`btn btn-sm target-opt ${selected ? 'btn-active' : ''}`}
                    onClick={() => chooseVictim(t.seat)}
                  >
                    {t.seat + 1} · {sanitizeInline(t.name)}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {puppet !== null && victim !== null ? (
        <div className="spread">
          <span className="muted">
            {labels.firstSet(seatName(puppet))} {labels.secondSet(seatName(victim))}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={() => submit(null, null)}>
            {GAME.cancelAction}
          </button>
        </div>
      ) : puppet !== null ? (
        <span className="faint">{labels.secondPending}</span>
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
            {GAME.jailSet(sanitizeInline(seats.find((s) => s.seat === own.jailTarget)?.name ?? ''))}
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
  // plants. gap H4: the Triad killers (Enforcer = Mafioso analogue, Dragon Head
  // = Godfather analogue) also attribute death notes. We surface the editor to
  // plausible holders; the server is authoritative on acceptance.
  return (
    role === 'SERIAL_KILLER' ||
    role === 'MAFIOSO' ||
    role === 'GODFATHER' ||
    role === 'FORGER' ||
    role === 'ENFORCER' ||
    role === 'DRAGON_HEAD'
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
