/**
 * TEST-MODE "Director" god-view panel (`packages/shared/src/protocol/debug.ts`).
 *
 * Rendered in-game ONLY when this client is receiving `debug_*` frames — i.e.
 * the host of a gated test lobby (the god audience). A normal (non-test, non-god)
 * client never has `debug.state`, so the panel never renders for them. See the
 * `<DirectorGate>` visibility gate at the bottom.
 *
 * It gives the host FULL VISIBILITY + AUDITABILITY for validating roles against
 * the real resolution engine (see `docs/ADDING_ROLES.md` §7):
 *   - Live board: every seat's true role/faction/alive/uses/immunity/flags.
 *   - Night intents: who → ability → whom, mafia roster, jail/grief marks.
 *   - Votes: live tally + per-seat votes, trial accused + verdicts.
 *   - Resolution traces: the §6.8 pipeline step-by-step per night, newest first.
 *   - Event log: the action-log mirror with a filter box.
 *   - Director controls: end phase, resend state, add/remove bots, audit JSON.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRole,
  RoleIdSchema,
  type DebugSeat,
  type DebugState,
  type DebugTrace,
  type DebugTraceRecord,
  type Faction,
  type RoleId,
  type TestBotPolicy,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { selfId, isHost } from '../lib/identity.js';
import { FactionIcon } from './Icons.js';
import {
  DIRECTOR,
  TRACE_STEP_LABEL,
  DEATH_CAUSE_LABEL,
  FACTION_LABEL,
} from '../lib/strings-extra.js';
import {
  testEndPhase,
  testRequestState,
  testAddBots,
  testRemoveBot,
} from '../ws/actions.js';
import { downloadAudit } from '../lib/api.js';

type Section = 'board' | 'intents' | 'votes' | 'traces' | 'events' | 'controls';

function seatName(state: DebugState, seat: number): string {
  const s = state.seats.find((x) => x.seat === seat);
  return s ? `#${seat + 1} ${s.name}` : `#${seat + 1}`;
}

/** Faction badge (color + icon + label, never color alone — colorblind rule). */
function FactionBadge({ faction }: { faction: Faction }) {
  return (
    <span className={`faction-tag faction-${faction}`}>
      <FactionIcon faction={faction} />
      {FACTION_LABEL[faction]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live board.
// ---------------------------------------------------------------------------

function boardFlags(seat: DebugSeat, exeTargetLabel: string | null): string[] {
  const flags: string[] = [];
  if (seat.nightImmune) flags.push(DIRECTOR.nightImmune);
  if (seat.mayorRevealed) flags.push(DIRECTOR.mayorRevealed);
  if (exeTargetLabel) flags.push(DIRECTOR.exeTarget(exeTargetLabel));
  if (seat.leaving) flags.push(DIRECTOR.leaving);
  if (seat.afk) flags.push(DIRECTOR.afk);
  if (!seat.connected) flags.push(DIRECTOR.disconnected);
  return flags;
}

function BoardSection({ state }: { state: DebugState }) {
  const mafia = new Set(state.mafiaRoster);
  return (
    <table className="director-table" aria-label={DIRECTOR.board}>
      <thead>
        <tr>
          <th>{DIRECTOR.seat}</th>
          <th>{DIRECTOR.role}</th>
          <th>{DIRECTOR.faction}</th>
          <th>{DIRECTOR.status}</th>
          <th>{DIRECTOR.uses}</th>
          <th>{DIRECTOR.controls}</th>
        </tr>
      </thead>
      <tbody>
        {state.seats.map((seat) => {
          const def = getRole(seat.role);
          const exeTargetLabel = seat.exeTarget !== null ? seatName(state, seat.exeTarget) : null;
          const flags = boardFlags(seat, exeTargetLabel);
          const uses =
            seat.usesRemaining === null
              ? DIRECTOR.unlimited
              : seat.selfUsesRemaining !== null
                ? `${seat.usesRemaining} (+${seat.selfUsesRemaining} self)`
                : String(seat.usesRemaining);
          return (
            <tr
              key={seat.seat}
              className={`${seat.alive ? '' : 'director-dead'} ${mafia.has(seat.seat) ? 'director-mafia' : ''}`}
            >
              <td>
                #{seat.seat + 1} {seat.name}
                {mafia.has(seat.seat) && <span className="badge director-tag">{DIRECTOR.mafiaRoster}</span>}
              </td>
              <td>{def.name}</td>
              <td>
                <FactionBadge faction={seat.faction} />
              </td>
              <td>
                <span className={`badge ${seat.alive ? 'badge-you' : ''}`}>
                  {seat.alive ? DIRECTOR.alive : DIRECTOR.dead}
                </span>
                {seat.revealed && <span className="badge">rev</span>}
              </td>
              <td>{uses}</td>
              <td className="director-flags">
                {flags.map((f) => (
                  <span key={f} className="badge">
                    {f}
                  </span>
                ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Night intents.
// ---------------------------------------------------------------------------

function IntentsSection({ state }: { state: DebugState }) {
  return (
    <div className="stack">
      <div className="row director-marks">
        <span className="badge">
          {DIRECTOR.mafiaRoster}: {state.mafiaRoster.map((s) => `#${s + 1}`).join(', ') || '—'}
        </span>
        {state.jailTarget !== null && (
          <span className="badge director-tag">{DIRECTOR.jailTarget(seatName(state, state.jailTarget))}</span>
        )}
        {state.pendingJesterGrief && state.pendingJesterGrief.length > 0 && (
          <span className="badge director-warn">
            {DIRECTOR.pendingJesterGrief}: {state.pendingJesterGrief.map((s) => `#${s + 1}`).join(', ')}
          </span>
        )}
      </div>
      {state.intents.length === 0 ? (
        <p className="muted">{DIRECTOR.noIntents}</p>
      ) : (
        <ul className="director-list">
          {state.intents.map((it, i) => {
            const mafia = state.mafiaRoster.includes(it.seat);
            return (
              <li key={`${it.seat}-${it.ability}-${i}`} className={mafia ? 'director-mafia' : ''}>
                <strong>{seatName(state, it.seat)}</strong> → <em>{it.ability}</em> →{' '}
                {it.target !== null ? seatName(state, it.target) : '—'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Votes.
// ---------------------------------------------------------------------------

function VotesSection({ state }: { state: DebugState }) {
  const hasVotes = state.voteTallies.length > 0 || state.votesBySeat.length > 0;
  return (
    <div className="stack">
      {state.trial && (
        <div className="row director-marks">
          <span className="badge director-warn">{DIRECTOR.trialAccused(seatName(state, state.trial.accused))}</span>
        </div>
      )}
      {state.trial && (
        <div>
          <div className="faint">{DIRECTOR.verdicts}</div>
          <ul className="director-list">
            {state.trial.verdicts.map((v) => (
              <li key={v.seat}>
                {seatName(state, v.seat)}: <strong>{v.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.voteTallies.length > 0 && (
        <div>
          <div className="faint">{DIRECTOR.tally}</div>
          <div className="row director-marks">
            {state.voteTallies.map((t) => (
              <span key={t.seat} className="badge">
                {seatName(state, t.seat)}: {t.weight}
              </span>
            ))}
          </div>
        </div>
      )}
      {state.votesBySeat.length > 0 && (
        <ul className="director-list">
          {state.votesBySeat.map((v) => (
            <li key={v.seat}>
              {seatName(state, v.seat)} →{' '}
              {v.target === 'skip' ? DIRECTOR.skip : seatName(state, v.target)}
            </li>
          ))}
        </ul>
      )}
      {!hasVotes && !state.trial && <p className="muted">{DIRECTOR.noVotes}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolution traces (the engine-audit tool).
// ---------------------------------------------------------------------------

/** Resolve an opaque role-id field to a display name, defaulting gracefully. */
function roleName(v: unknown): string {
  const parsed = RoleIdSchema.safeParse(v);
  return getRole((parsed.success ? parsed.data : 'CITIZEN') as RoleId).name;
}

/** Human-readable one-line summary of a single ResolutionTrace record. */
export function describeTrace(rec: DebugTraceRecord, name: (seat: number) => string): string {
  const r = rec as Record<string, unknown>;
  const s = (k: string): string => (typeof r[k] === 'number' ? name(r[k] as number) : '—');
  switch (rec.step) {
    case 'jail':
      return `${s('jailor')} jails ${s('prisoner')}`;
    case 'roleblock':
      return `${s('blocker')} roleblocks ${s('target')} → ${String(r['outcome'])}`;
    case 'sk_redirect':
      return `${s('sk')} redirected by ${s('blocker')} (was ${r['originalTarget'] !== null ? s('originalTarget') : '—'})`;
    case 'protect':
      return `${s('doctor')} protects ${s('target')} (${String(r['kind'])})`;
    case 'frame':
      return `${s('framer')} frames ${s('target')}`;
    case 'kill':
      return `${String(r['source'])}: ${r['attacker'] !== null ? s('attacker') : '—'} → ${s('target')} → ${String(r['outcome'])}`;
    case 'investigate': {
      const kind = String(r['kind']);
      if (kind === 'lookout') {
        const visitors = Array.isArray(r['visitors']) ? (r['visitors'] as number[]).map(name).join(', ') : '—';
        return `lookout ${s('investigator')} on ${s('target')} → [${visitors || '—'}]`;
      }
      return `${kind} ${s('investigator')} on ${s('target')} → ${String(r['result'])}`;
    }
    case 'death':
      return `${s('seat')} dies (${roleName(r['role'])}, ${String(r['cause'])})`;
    case 'promotion':
      return r['kind'] === 'mafia_succession'
        ? `${s('seat')} promoted → ${roleName(r['newRole'])}`
        : `${s('seat')} executioner → jester`;
    case 'win':
      return `win: ${String(r['reason'])} → ${Array.isArray(r['winners']) ? (r['winners'] as string[]).join(', ') : '—'}`;
    default:
      return rec.step;
  }
}

function TraceNight({
  trace,
  name,
}: {
  trace: DebugTrace;
  name: (seat: number) => string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="panel panel-pad director-trace">
      <button className="director-trace-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <strong>{DIRECTOR.night(trace.nightNumber)}</strong>
        <span className="muted">
          {' '}
          · {trace.traces.length} {DIRECTOR.step}s ·{' '}
          {trace.deaths.length > 0
            ? `${trace.deaths.length} ${DIRECTOR.deaths.toLowerCase()}`
            : DIRECTOR.noDeaths}
        </span>
        <span className="director-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="stack">
          {trace.deaths.length > 0 && (
            <div className="row director-marks">
              {trace.deaths.map((d, i) => (
                <span key={`${d.seat}-${i}`} className="badge director-warn">
                  {name(d.seat)} — {DEATH_CAUSE_LABEL[d.cause]}
                </span>
              ))}
            </div>
          )}
          <ol className="director-steps">
            {trace.traces.map((rec, i) => (
              <li key={i}>
                <span className="director-step-tag">{TRACE_STEP_LABEL[rec.step] ?? rec.step}</span>
                <span>{describeTrace(rec, name)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function TracesSection({
  traces,
  name,
}: {
  traces: DebugTrace[];
  name: (seat: number) => string;
}) {
  if (traces.length === 0) return <p className="muted">{DIRECTOR.noTraces}</p>;
  // Newest night on top.
  const ordered = [...traces].sort((a, b) => b.nightNumber - a.nightNumber);
  return (
    <div className="stack">
      {ordered.map((t) => (
        <TraceNight key={t.nightNumber} trace={t} name={name} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event log.
// ---------------------------------------------------------------------------

function EventsSection() {
  const events = useStore((s) => s.debug.events);
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = f
      ? events.filter((e) => {
          const seatStr = e.seat !== undefined ? `#${e.seat + 1}` : '';
          return (
            e.eventType.toLowerCase().includes(f) ||
            e.phase.toLowerCase().includes(f) ||
            seatStr.includes(f) ||
            String(e.seq).includes(f)
          );
        })
      : events;
    return [...list].reverse(); // newest first
  }, [events, f]);

  return (
    <div className="stack">
      <input
        className="grow"
        value={filter}
        placeholder={DIRECTOR.eventFilterPlaceholder}
        onChange={(e) => setFilter(e.target.value)}
      />
      {rows.length === 0 ? (
        <p className="muted">{DIRECTOR.noEvents}</p>
      ) : (
        <div className="director-events">
          {rows.map((e) => (
            <div key={e.seq} className="director-event">
              <span className="director-seq">{e.seq}</span>
              <span className="badge">{e.phase}</span>
              <strong>{e.eventType}</strong>
              {e.seat !== undefined && <span className="muted">#{e.seat + 1}</span>}
              <code className="director-payload">{JSON.stringify(e.payload)}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Director controls.
// ---------------------------------------------------------------------------

function ControlsSection({ state, roomId }: { state: DebugState; roomId: string | null }) {
  const pushInfo = useStore((s) => s.pushInfo);
  const [count, setCount] = useState(1);
  const [policy, setPolicy] = useState<TestBotPolicy>('scripted');
  // Bots may only be added/removed before the game starts. ASSIGN/DAY_0 are the
  // pre-game phases; once a NIGHT has run the server rejects with wrong_phase.
  const preGame = state.phase === 'ASSIGN' || state.phase === 'DAY_0';

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => testEndPhase()} title={DIRECTOR.endPhaseHint}>
          {DIRECTOR.endPhase}
        </button>
        <button className="btn btn-sm" onClick={() => testRequestState()}>
          {DIRECTOR.resendState}
        </button>
        <button
          className="btn btn-sm"
          disabled={!roomId}
          onClick={() => {
            if (!roomId) return;
            void downloadAudit(roomId).catch(() => pushInfo(DIRECTOR.auditFailed));
          }}
        >
          {DIRECTOR.downloadAudit}
        </button>
      </div>

      <div className="panel panel-pad stack">
        <div className="faint">{DIRECTOR.addBots}</div>
        {!preGame && <p className="muted">{DIRECTOR.preGameOnly}</p>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label>
            {DIRECTOR.count}{' '}
            <input
              type="number"
              min={1}
              max={15}
              value={count}
              style={{ width: 64 }}
              disabled={!preGame}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(15, Number(e.target.value) || 1)))
              }
            />
          </label>
          <label>
            {DIRECTOR.policy}{' '}
            <select
              value={policy}
              disabled={!preGame}
              onChange={(e) => setPolicy(e.target.value as TestBotPolicy)}
            >
              <option value="scripted">{DIRECTOR.policyScripted}</option>
              <option value="llm">{DIRECTOR.policyLlm}</option>
            </select>
          </label>
          <button
            className="btn btn-sm"
            disabled={!preGame}
            onClick={() => testAddBots(count, policy)}
          >
            {DIRECTOR.addBots}
          </button>
          <button
            className="btn btn-sm btn-danger"
            disabled={!preGame}
            onClick={() => testRemoveBot('all')}
          >
            {DIRECTOR.removeAll}
          </button>
        </div>
        {preGame && (
          <div className="row director-marks">
            {state.seats.map((s) => (
              <button
                key={s.seat}
                className="btn btn-sm btn-danger"
                onClick={() => testRemoveBot(s.seat)}
                title={DIRECTOR.removeBot}
              >
                {DIRECTOR.removeBot} #{s.seat + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel shell.
// ---------------------------------------------------------------------------

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'board', label: DIRECTOR.board },
  { id: 'intents', label: DIRECTOR.intents },
  { id: 'votes', label: DIRECTOR.votes },
  { id: 'traces', label: DIRECTOR.traces },
  { id: 'events', label: DIRECTOR.events },
  { id: 'controls', label: DIRECTOR.controls },
];

/** The Director panel proper — assumes a non-null `debug.state` (god audience). */
export function DirectorPanel({ state, roomId }: { state: DebugState; roomId: string | null }) {
  const traces = useStore((s) => s.debug.traces);
  const [collapsed, setCollapsed] = useState(false);
  const [section, setSection] = useState<Section>('board');

  const name = useCallback((seat: number) => seatName(state, seat), [state]);

  // Keyboard-friendly: Shift+E ends the current phase (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      if (e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        testEndPhase();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="director-panel panel" aria-label={DIRECTOR.title}>
      <header className="director-head">
        <span className="badge director-test-badge">{DIRECTOR.testBadge}</span>
        <strong>{DIRECTOR.title}</strong>
        <span className="muted">{DIRECTOR.subtitle}</span>
        <span className="muted">
          {' '}
          · {state.phase} · D{state.dayNumber}/N{state.nightNumber}
        </span>
        <button
          className="btn btn-sm director-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? DIRECTOR.expand : DIRECTOR.collapse}
        </button>
      </header>

      {!collapsed && (
        <div className="director-body">
          <nav className="director-tabs" role="tablist">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                className={`btn btn-sm ${section === s.id ? 'btn-active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="director-section">
            {section === 'board' && <BoardSection state={state} />}
            {section === 'intents' && <IntentsSection state={state} />}
            {section === 'votes' && <VotesSection state={state} />}
            {section === 'traces' && <TracesSection traces={traces} name={name} />}
            {section === 'events' && <EventsSection />}
            {section === 'controls' && <ControlsSection state={state} roomId={roomId} />}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Visibility gate: renders the Director panel ONLY when this client is the god
 * audience (it has received a `debug_state`). Normal clients never get debug
 * frames, so `debug.state` stays null and nothing renders — no regression to
 * normal play.
 */
export function DirectorGate() {
  const state = useStore((s) => s.debug.state);
  const lobby = useStore((s) => s.lobby);
  const self = useStore((s) => selfId(s));
  if (!state) return null;
  // roomId === lobby id (the server reuses the lobby id as the room id). Only a
  // host gets a meaningful audit URL; for a non-host god (spectating host) the
  // audit button is disabled.
  const roomId = lobby && isHost(lobby, self) ? lobby.id : null;
  return <DirectorPanel state={state} roomId={roomId} />;
}
