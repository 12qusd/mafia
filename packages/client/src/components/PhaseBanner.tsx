/** Phase banner + countdown + day number (BUILD_SPEC §13.1 top region). */

import { strings, type Phase } from '@nocturne/shared';
import { useCountdown } from './useCountdown.js';
import { formatCountdown } from '../lib/clock.js';
import { GAME } from '../lib/strings-extra.js';
import { IconMoon, IconSun } from './Icons.js';

export function PhaseBanner({
  phase,
  dayNumber,
  endsAt,
}: {
  phase: Phase;
  dayNumber: number;
  endsAt: number | null;
}) {
  const secs = useCountdown(endsAt);
  const isNight = phase === 'NIGHT';
  const dayLabel = isNight ? GAME.nightNumber(dayNumber) : GAME.dayNumber(dayNumber);

  return (
    <div className="phase-banner">
      <div className="row center" style={{ gap: 8, justifyContent: 'center' }}>
        {isNight ? <IconMoon /> : <IconSun />}
        <span className="phase-title">{strings.PHASE_BANNER[phase]}</span>
      </div>
      <div className="phase-day">{dayLabel}</div>
      {endsAt !== null && (
        <div className={`countdown ${secs <= 10 ? 'urgent' : ''}`}>{formatCountdown(secs)}</div>
      )}
    </div>
  );
}
