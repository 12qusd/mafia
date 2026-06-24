/**
 * Screen-reader status announcer (accessibility).
 *
 * A visually-hidden `aria-live="assertive"` region that announces the dramatic
 * game-state transitions a sighted player reads off the phase banner, the death
 * feed, and the trial overlay: phase changes ("Night falls", "Day 2"), deaths,
 * and lynch/execution verdicts. It subscribes to the existing store state and
 * emits ONLY the delta (the latest transition), never the whole history — so a
 * screen reader speaks each beat once.
 *
 * Everything announced is server-sourced and sanitized; this component invents
 * no state (§13.2) and sends nothing. It renders nothing visible.
 */

import { useEffect, useRef, useState } from 'react';
import { strings, type Phase } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { GAME } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';

/** Concise spoken label for a phase transition (distinct from the banner copy). */
function phaseAnnouncement(phase: Phase, dayNumber: number): string {
  switch (phase) {
    case 'NIGHT':
      return GAME.announceNight(dayNumber);
    case 'DAWN':
      return GAME.announceDawn(dayNumber);
    case 'DAY_DISCUSSION':
    case 'DAY_0':
      return GAME.announceDay(dayNumber);
    case 'DAY_VOTING':
      return GAME.announceVoting;
    case 'TRIAL_DEFENSE':
      return GAME.announceTrialDefense;
    case 'TRIAL_JUDGMENT':
      return GAME.announceTrialJudgment;
    case 'EXECUTION':
      return GAME.announceExecution;
    case 'GAME_OVER':
      return strings.PHASE_BANNER.GAME_OVER;
    default:
      return '';
  }
}

export function LiveAnnouncer() {
  const phase = useStore((s) => s.game?.phase ?? null);
  const dayNumber = useStore((s) => s.game?.dayNumber ?? 0);
  const seats = useStore((s) => s.game?.seats);
  const deathFeed = useStore((s) => s.game?.deathFeed);
  const lastVerdict = useStore((s) => s.game?.lastVerdict ?? null);

  const [message, setMessage] = useState('');
  const prevPhase = useRef<Phase | null>(null);
  const prevDay = useRef<number>(0);
  const announcedDeaths = useRef<Set<number>>(new Set());
  const prevVerdictKey = useRef<string | null>(null);

  // Phase / day transitions.
  useEffect(() => {
    if (phase === null) {
      prevPhase.current = null;
      prevDay.current = 0;
      announcedDeaths.current = new Set();
      prevVerdictKey.current = null;
      return;
    }
    if (phase !== prevPhase.current || dayNumber !== prevDay.current) {
      const text = phaseAnnouncement(phase, dayNumber);
      if (text) setMessage(text);
      prevPhase.current = phase;
      prevDay.current = dayNumber;
    }
  }, [phase, dayNumber]);

  // New deaths surfaced in the paced feed → announce each seat once.
  useEffect(() => {
    if (!deathFeed || deathFeed.length === 0) return;
    const fresh = deathFeed.find((d) => !announcedDeaths.current.has(d.seat));
    if (!fresh) return;
    announcedDeaths.current.add(fresh.seat);
    const name = sanitizeInline(seats?.find((s) => s.seat === fresh.seat)?.name ?? `#${fresh.seat + 1}`);
    setMessage(GAME.announceDeath(name));
  }, [deathFeed, seats]);

  // Trial verdict (lynch / acquittal).
  useEffect(() => {
    if (!lastVerdict) return;
    const key = `${lastVerdict.accusedSeat}:${lastVerdict.outcome}`;
    if (key === prevVerdictKey.current) return;
    prevVerdictKey.current = key;
    const name = sanitizeInline(
      seats?.find((s) => s.seat === lastVerdict.accusedSeat)?.name ?? `#${lastVerdict.accusedSeat + 1}`,
    );
    if (lastVerdict.outcome === 'guilty') setMessage(GAME.announceLynched(name));
    else if (lastVerdict.outcome === 'innocent') setMessage(GAME.announceAcquitted(name));
  }, [lastVerdict, seats]);

  return (
    <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
      {message}
    </div>
  );
}
