/**
 * Replay viewer (goal 7). Fetches `GET /api/matches/:matchId/replay`, shows the
 * integrity verdict, the final roster, a scrubbable reconstructed timeline
 * (events folded through the pure engine), and the chat transcript. Offers a
 * raw-JSON download.
 *
 * The events fully drive state; we reconstruct phase/day + living/dead at the
 * scrubber position. Role assignment is resolved from the shipped setup when
 * possible. All server-derived text is sanitized on render.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRole, type Faction, type RoleId } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead, FactionTag } from '../components/common.js';
import { IconSkull } from '../components/Icons.js';
import { REPLAY, OUTCOME_LABEL, GAME, SHARE } from '../lib/strings-extra.js';
import { sanitizeInline, sanitizeText } from '../lib/sanitize.js';
import { copyReplayLink } from '../lib/social.js';
import * as api from '../lib/api.js';
import type { MatchReplay } from '../lib/api.js';
import { reconstructReplay } from '../lib/replay.js';

function isFaction(v: string): v is Faction {
  return v === 'TOWN' || v === 'MAFIA' || v === 'NEUTRAL_KILLING' || v === 'NEUTRAL_BENIGN';
}

export function ReplayScreen() {
  const { matchId } = useParams();
  const pushInfo = useStore((s) => s.pushInfo);
  const [replay, setReplay] = useState<MatchReplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void api.fetchReplay(matchId ?? '').then((r) => {
      if (!live) return;
      setReplay(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [matchId]);

  const recon = useMemo(() => {
    if (!replay) return null;
    return reconstructReplay(
      replay.match.setupId,
      replay.match.seed,
      replay.match.players.length,
      replay.match.events,
    );
  }, [replay]);

  // Clamp the scrubber when a new reconstruction arrives.
  useEffect(() => {
    if (recon && recon.steps.length > 0) setStep(recon.steps.length - 1);
    else setStep(0);
  }, [recon]);

  if (loading) {
    return (
      <div className="page center" style={{ minHeight: '40vh' }} aria-busy="true">
        <div className="route-loading" role="status" aria-live="polite">
          <div className="noir-spinner" aria-hidden="true" />
          <span className="faint route-loading-text">{REPLAY.loading}</span>
        </div>
      </div>
    );
  }

  if (!replay) {
    return (
      <div className="page center" style={{ minHeight: '40vh' }}>
        <div className="panel panel-pad center stack" style={{ textAlign: 'center' }}>
          <h2>{REPLAY.notFound}</h2>
          <Link className="btn" to="/">
            {REPLAY.back}
          </Link>
        </div>
      </div>
    );
  }

  const m = replay.match;
  const verified = replay.integrity.verified;
  const steps = recon?.steps ?? [];
  const cur = steps[step] ?? null;
  const livingSet = new Set(cur?.living ?? []);

  // Roster ordered by seat; role/faction from the replay (server truth).
  const roster = [...m.players].sort((a, b) => a.seat - b.seat);

  return (
    <div className="page stack">
      {/* Header + integrity verdict. */}
      <div className="panel panel-pad stack">
        <div className="spread">
          <div>
            <h1 style={{ margin: 0 }}>{REPLAY.heading}</h1>
            <span className="muted">
              {sanitizeInline(m.setupId)} · seed <code>{sanitizeInline(m.seed)}</code>
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span
              className={`badge replay-verdict ${verified ? 'replay-verified' : 'replay-unverified'}`}
              title={`${REPLAY.fingerprint}: ${replay.integrity.fingerprint}`}
            >
              {verified ? '✓' : '!'} {verified ? REPLAY.verified : REPLAY.unverified}
            </span>
            <button
              className="btn btn-sm"
              title={SHARE.title}
              onClick={() => {
                void copyReplayLink(m.id).then((ok) =>
                  pushInfo(ok ? SHARE.copied : SHARE.failed),
                );
              }}
            >
              {SHARE.button}
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                void api.downloadReplay(m.id).catch(() => pushInfo(REPLAY.notFound));
              }}
            >
              {REPLAY.download}
            </button>
          </div>
        </div>
        <div className="faint" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>
          {REPLAY.fingerprint}: <code>{sanitizeInline(replay.integrity.fingerprint)}</code>
        </div>
      </div>

      <div className="lobby-grid">
        {/* Final roster. */}
        <div className="panel panel-pad stack">
          <DecoHead>{REPLAY.roster}</DecoHead>
          <div className="table-scroll">
          <table className="reveal-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Role</th>
                <th>Faction</th>
                <th>Result</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                const faction: Faction = isFaction(p.faction) ? p.faction : 'TOWN';
                const role = getRole(p.role as RoleId);
                const aliveNow = livingSet.has(p.seat);
                return (
                  <tr key={p.seat} className={aliveNow ? '' : 'replay-dead'}>
                    <td>{p.seat + 1}</td>
                    <td>{role.name}</td>
                    <td>
                      <FactionTag faction={faction} />
                    </td>
                    <td>
                      {p.outcome in OUTCOME_LABEL
                        ? OUTCOME_LABEL[p.outcome as keyof typeof OUTCOME_LABEL]
                        : sanitizeInline(p.outcome)}
                    </td>
                    <td>
                      {aliveNow ? (
                        <span className="badge badge-you">{REPLAY.living}</span>
                      ) : (
                        <span className="badge">
                          <IconSkull size={11} /> {REPLAY.dead}
                          {p.deathDay !== null ? ` · D${p.deathDay}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        {/* Timeline scrubber. */}
        <div className="panel panel-pad stack">
          <DecoHead>{REPLAY.timeline}</DecoHead>
          {recon && recon.ok && steps.length > 0 && cur ? (
            <>
              <div className="replay-phase">
                <span className="phase-title">{phaseLabel(cur.phase, cur.dayNumber)}</span>
                <span className="phase-day">{REPLAY.step(step + 1, steps.length)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={steps.length - 1}
                value={step}
                aria-label={REPLAY.timeline}
                onChange={(e) => setStep(Number(e.target.value))}
                className="replay-scrubber"
              />
              <div className="replay-counts">
                <span className="badge badge-you">
                  {REPLAY.living}: {cur.living.length}
                </span>
                <span className="badge">
                  {REPLAY.dead}: {cur.dead.length}
                </span>
                <span className="faint">· {sanitizeInline(cur.label)}</span>
              </div>
              <div className="replay-seatgrid">
                {[...cur.living, ...cur.dead]
                  .sort((a, b) => a - b)
                  .map((seat) => {
                    const alive = livingSet.has(seat);
                    return (
                      <span key={seat} className={`replay-seat ${alive ? '' : 'replay-seat-dead'}`}>
                        {seat + 1}
                        {!alive && <IconSkull size={11} />}
                      </span>
                    );
                  })}
              </div>
            </>
          ) : (
            <p className="muted">{REPLAY.reconstructError}</p>
          )}
        </div>
      </div>

      {/* Chat transcript. */}
      <div className="panel panel-pad stack">
        <DecoHead>{REPLAY.transcript}</DecoHead>
        {m.chat.length === 0 ? (
          <p className="muted">{REPLAY.noChat}</p>
        ) : (
          <div className="replay-transcript">
            {m.chat
              .slice()
              .sort((a, b) => a.seq - b.seq)
              .map((c) => (
                <div className="chat-line" key={c.seq}>
                  <span className="badge" style={{ marginRight: 6 }}>
                    {sanitizeInline(c.channel)}
                  </span>
                  <span className="chat-from">
                    {c.senderSeat !== null ? `#${c.senderSeat + 1}` : '—'}
                  </span>{' '}
                  {sanitizeText(c.body)}
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="row">
        <Link className="btn" to="/">
          {REPLAY.back}
        </Link>
      </div>
    </div>
  );
}

function phaseLabel(phase: string, dayNumber: number): string {
  if (phase === 'NIGHT') return GAME.nightNumber(dayNumber);
  return `${GAME.dayNumber(dayNumber)} · ${phase}`;
}
