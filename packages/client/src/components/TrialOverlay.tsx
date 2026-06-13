/**
 * Trial overlay (BUILD_SPEC §13.1, §6.3): accused, defense-phase timer,
 * guilty/innocent/abstain buttons during TRIAL_JUDGMENT, then per-voter verdict
 * reveal (verdict_result).
 */

import { type PublicSeat, type Phase, type VerdictResult } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { useCountdown } from './useCountdown.js';
import { GAME, TRIAL_OUTCOME_LABEL, VERDICT_LABEL } from '../lib/strings-extra.js';
import { IconGavel } from './Icons.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { sendVerdict } from '../ws/actions.js';

export function TrialOverlay({
  phase,
  accusedSeat,
  endsAt,
  seats,
  ownSeat,
  alive,
  spectator,
  lastVerdict,
}: {
  phase: Phase;
  accusedSeat: number | null;
  endsAt: number | null;
  seats: PublicSeat[];
  ownSeat: number | null;
  alive: boolean;
  spectator: boolean;
  lastVerdict: VerdictResult | null;
}) {
  const verdict = useStore((s) => s.own?.verdict ?? null);
  const secs = useCountdown(endsAt);

  // Verdict reveal takes priority right after judgment.
  if (lastVerdict && phase === 'EXECUTION') {
    return <VerdictReveal result={lastVerdict} seats={seats} />;
  }

  if (accusedSeat === null) return null;
  const accusedName = sanitizeInline(seats.find((s) => s.seat === accusedSeat)?.name ?? '');
  const isAccused = ownSeat === accusedSeat;

  const inDefense = phase === 'TRIAL_DEFENSE';
  const inJudgment = phase === 'TRIAL_JUDGMENT';
  const canVote = inJudgment && alive && !spectator && !isAccused;

  return (
    <div className="trial-overlay panel panel-pad stack">
      <div className="spread">
        <span className="row" style={{ gap: 6 }}>
          <IconGavel />
          <strong>{GAME.trialAccused(accusedName)}</strong>
        </span>
        {endsAt !== null && <span className="countdown" style={{ fontSize: '1.1rem' }}>{secs}s</span>}
      </div>

      {inDefense && (
        <span className="muted">{isAccused ? GAME.yourTurnToSpeak : GAME.trialDefense}</span>
      )}

      {inJudgment && (
        <>
          <span className="muted">{GAME.trialJudgment}</span>
          {canVote ? (
            <div className="verdict-btns">
              <button
                className={`btn btn-danger ${verdict === 'guilty' ? 'btn-active' : ''}`}
                onClick={() => {
                  useStore.getState().setVerdict('guilty');
                  sendVerdict('guilty');
                }}
              >
                {GAME.verdictGuilty}
              </button>
              <button
                className={`btn ${verdict === 'innocent' ? 'btn-active' : ''}`}
                onClick={() => {
                  useStore.getState().setVerdict('innocent');
                  sendVerdict('innocent');
                }}
              >
                {GAME.verdictInnocent}
              </button>
              <button
                className={`btn btn-ghost ${verdict === 'abstain' ? 'btn-active' : ''}`}
                onClick={() => {
                  useStore.getState().setVerdict('abstain');
                  sendVerdict('abstain');
                }}
              >
                {GAME.verdictAbstain}
              </button>
            </div>
          ) : (
            <span className="faint">
              {isAccused ? GAME.yourTurnToSpeak : 'The living render their verdict.'}
            </span>
          )}
          {verdict && <span className="muted">{GAME.verdictCast(VERDICT_LABEL[verdict])}</span>}
        </>
      )}
    </div>
  );
}

function VerdictReveal({ result, seats }: { result: VerdictResult; seats: PublicSeat[] }) {
  const accusedName = sanitizeInline(seats.find((s) => s.seat === result.accusedSeat)?.name ?? '');
  return (
    <div className="trial-overlay panel panel-pad stack">
      <div className="spread">
        <strong>{GAME.verdictReveal}</strong>
        <span className={result.outcome === 'guilty' ? 'error-text' : 'muted'}>
          {accusedName}: {TRIAL_OUTCOME_LABEL[result.outcome]}
        </span>
      </div>
      <div className="setup-roles">
        {result.votes.map((v) => (
          <span key={v.seat} className="role-chip">
            {sanitizeInline(seats.find((s) => s.seat === v.seat)?.name ?? `#${v.seat + 1}`)}:{' '}
            {VERDICT_LABEL[v.value]}
          </span>
        ))}
      </div>
    </div>
  );
}
