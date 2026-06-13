/**
 * Player list (BUILD_SPEC §13.1 right column): seat number, name, alive/dead
 * (dead show revealed role), vote button + live tally during DAY_VOTING,
 * skip-day, connection/AFK badges, mayor-revealed marker, report/mute.
 */

import { useMemo } from 'react';
import { getRole, type PublicSeat, type Phase, REPORT_CATEGORIES } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { GAME } from '../lib/strings-extra.js';
import { FactionTag, DecoHead } from './common.js';
import { IconSkull } from './Icons.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { sendVote, reportPlayer } from '../ws/actions.js';

export function PlayerList({
  seats,
  phase,
  ownSeat,
  accusedSeat,
  tallies,
  votesBySeat,
  alive,
  spectator,
  onWhisper,
}: {
  seats: PublicSeat[];
  phase: Phase;
  ownSeat: number | null;
  accusedSeat: number | null;
  tallies: { seat: number; weight: number }[];
  votesBySeat: { seat: number; target: number | 'skip' }[];
  alive: boolean;
  spectator: boolean;
  onWhisper: (seat: number) => void;
}) {
  const vote = useStore((s) => s.own?.vote ?? null);
  const muted = useStore((s) => s.settings.mutedSeats);
  const toggleMute = useStore((s) => s.toggleMute);

  const tallyBySeat = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tallies) m.set(t.seat, t.weight);
    return m;
  }, [tallies]);

  const voting = phase === 'DAY_VOTING';
  const canVote = voting && alive && !spectator;
  const skipWeight = votesBySeat.filter((v) => v.target === 'skip').length;

  return (
    <div className="panel panel-pad game-col" style={{ overflow: 'hidden' }}>
      <DecoHead>{GAME.seatHeading}</DecoHead>
      <div className="seat-list">
        {seats.map((s) => {
          const isSelf = s.seat === ownSeat;
          const isAccused = s.seat === accusedSeat;
          const revealedRole = s.role ? getRole(s.role) : null;
          const weight = tallyBySeat.get(s.seat) ?? 0;
          const myVote = vote === s.seat;
          return (
            <div
              key={s.seat}
              className={`seat ${s.alive ? '' : 'dead'} ${isAccused ? 'accused' : ''} ${
                isSelf ? 'self' : ''
              }`}
            >
              <span className="seat-num">{s.seat + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span
                    className="seat-name"
                    onClick={() => !isSelf && s.alive && onWhisper(s.seat)}
                    title={isSelf ? GAME.spectating : 'Whisper'}
                  >
                    {sanitizeInline(s.name)}
                  </span>
                  {!s.alive && <IconSkull size={13} />}
                </div>
                <div className="seat-badges">
                  {!s.alive && revealedRole && (
                    <>
                      <span className="badge">{GAME.revealedAs(revealedRole.name)}</span>
                      <FactionTag faction={revealedRole.faction} />
                    </>
                  )}
                  {s.alive && !s.connected && <span className="badge">{GAME.disconnectedBadge}</span>}
                  {s.alive && s.afk && <span className="badge">{GAME.afkBadge}</span>}
                  {!isSelf && (
                    <button
                      className="linkbtn"
                      style={{ fontSize: '0.75em' }}
                      onClick={() => toggleMute(s.seat)}
                    >
                      {muted.includes(s.seat) ? GAME.unmute : GAME.mute}
                    </button>
                  )}
                  {!isSelf && !spectator && (
                    <ReportButton seat={s.seat} />
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {voting && weight > 0 && <span className="seat-tally">{weight}</span>}
                {canVote && s.alive && !isSelf && (
                  <button
                    className={`btn btn-sm ${myVote ? 'btn-active' : ''}`}
                    onClick={() => sendVote(myVote ? null : s.seat)}
                  >
                    {myVote ? GAME.retractVote : GAME.voteFor}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canVote && (
        <button
          className={`btn btn-sm ${vote === 'skip' ? 'btn-active' : ''}`}
          style={{ marginTop: 8 }}
          onClick={() => sendVote(vote === 'skip' ? null : 'skip')}
        >
          {GAME.skipDay} {skipWeight > 0 ? `(${skipWeight})` : ''}
        </button>
      )}
    </div>
  );
}

function ReportButton({ seat }: { seat: number }) {
  return (
    <select
      className="linkbtn"
      style={{ width: 'auto', background: 'transparent', border: 'none', color: 'var(--c-text-faint)', fontSize: '0.75em' }}
      value=""
      onChange={(e) => {
        const cat = e.target.value;
        if (cat) {
          reportPlayer(seat, cat as (typeof REPORT_CATEGORIES)[number]);
          useStore.getState().pushInfo('Report sent to the house.');
          e.target.value = '';
        }
      }}
    >
      <option value="">{GAME.report}…</option>
      {REPORT_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
