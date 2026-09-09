import { strings, type Phase, type PublicSeat } from '@nocturne/shared';
import { useCountdown } from './useCountdown.js';
import { formatCountdown } from '../lib/clock.js';
import { sanitizeInline } from '../lib/sanitize.js';

const PROMPT: Record<Phase, string> = {
  LOBBY: 'The town is gathering.',
  ASSIGN: 'Read your role. Keep your identity close.',
  DAY_0: 'Meet the town. Listen carefully before night falls.',
  NIGHT: 'Choose your action in Your Role before the night ends.',
  DAWN: 'Review what happened overnight. Every detail matters.',
  DAY_DISCUSSION: 'Share your findings in chat. Who can you trust?',
  DAY_VOTING: 'Choose a suspect from The Table to put them on trial.',
  TRIAL_DEFENSE: 'Hear the accused. Their life is in the town’s hands.',
  TRIAL_JUDGMENT: 'Weigh the testimony. Cast your verdict.',
  EXECUTION: 'The town has made its decision.',
  GAME_OVER: 'The masks come off. Discover who was telling the truth.',
};

/** Only public seats and the local seat number enter this presentation. */
export function TownScene({
  seats,
  phase,
  dayNumber,
  endsAt,
  ownSeat,
}: {
  seats: PublicSeat[];
  phase: Phase;
  dayNumber: number;
  endsAt: number | null;
  ownSeat: number | null;
}) {
  const seconds = useCountdown(endsAt);
  const alive = seats.filter((seat) => seat.alive).length;
  const dead = ownSeat !== null && seats.some((s) => s.seat === ownSeat && !s.alive);
  return (
    <section className={`town-scene town-${phase.toLowerCase()}`} aria-label="Town square">
      <div className="town-hud">
        <div>
          <div className="eyebrow">
            {phase === 'NIGHT' ? 'Night' : 'Day'} {dayNumber} <span className="hud-divider">/</span>{' '}
            {alive} of {seats.length} alive
          </div>
          <h1>{strings.PHASE_BANNER[phase]}</h1>
          <p>
            {dead
              ? 'Your story lives on in dead chat. Watch the mystery unfold.'
              : ownSeat === null
                ? 'You are watching the town as a spectator.'
                : PROMPT[phase]}
          </p>
        </div>
        {endsAt !== null && (
          <div className={`town-clock ${seconds <= 10 ? 'urgent' : ''}`}>
            <span className="eyebrow">Time remaining</span>
            <strong>{formatCountdown(seconds)}</strong>
          </div>
        )}
      </div>
      <div className="town-cast" aria-label="Seats in the town">
        {seats.map((s) => (
          <div
            key={s.seat}
            className={`town-resident ${s.alive ? '' : 'departed'} ${s.seat === ownSeat ? 'resident-you' : ''}`}
            title={`${s.seat + 1}. ${sanitizeInline(s.name)}${s.alive ? '' : ' — dead'}`}
          >
            <svg viewBox="0 0 70 86" aria-hidden="true">
              <path className="resident-coat" d="M9 86 15 60 27 52 43 52 55 60 61 86Z" />
              <path className="resident-shirt" d="m27 54 8 26 8-26-8 5Z" />
              <path className="resident-face" d="M23 29h24v12q-1 15-12 15T23 41Z" />
              <path className="resident-hat" d="m18 28 5-19h24l5 19 9 3v5H9v-5Z" />
              <path className="resident-band" d="M21 23h29v6H20Z" />
            </svg>
            <span className="resident-number">{s.alive ? s.seat + 1 : '✕'}</span>
            <span className="resident-name">
              {s.seat === ownSeat ? 'You' : sanitizeInline(s.name).replace(/^Bot · /, '')}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
