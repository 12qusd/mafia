/**
 * Settings screen (BUILD_SPEC §13.1, §13.2): profanity-filter display toggle,
 * mute-list management, colorblind-safe palette toggle (faction color is never
 * the only signal — icon + label always present), text scale, sound cues.
 */

import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, Switch } from '../components/common.js';
import { SETTINGS } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import type { TextScale, AnimationLevel } from '../lib/storage.js';

export function SettingsScreen() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const setProfanity = useStore((s) => s.setProfanityFilter);
  const setColorblind = useStore((s) => s.setColorblind);
  const setTextScale = useStore((s) => s.setTextScale);
  const setSound = useStore((s) => s.setSound);
  const setAnimations = useStore((s) => s.setAnimations);
  const toggleMute = useStore((s) => s.toggleMute);
  const seats = useStore((s) => s.game?.seats ?? []);

  const nameFor = (seat: number) =>
    sanitizeInline(seats.find((s) => s.seat === seat)?.name ?? `#${seat + 1}`);

  return (
    <div className="page stack" style={{ maxWidth: 640 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>{SETTINGS.heading}</h1>
        <button className="btn" onClick={() => navigate(-1)}>
          {SETTINGS.back}
        </button>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>Display</DecoHead>

        <div className="toggle">
          <div>
            <div>{SETTINGS.profanityFilter}</div>
            <div className="faint">{SETTINGS.profanityFilterHint}</div>
          </div>
          <Switch on={settings.profanityFilter} label={SETTINGS.profanityFilter} onChange={setProfanity} />
        </div>

        <div className="toggle">
          <div>
            <div>{SETTINGS.colorblind}</div>
            <div className="faint">{SETTINGS.colorblindHint}</div>
          </div>
          <Switch on={settings.colorblind} label={SETTINGS.colorblind} onChange={setColorblind} />
        </div>

        <div className="toggle">
          <div>{SETTINGS.sound}</div>
          <Switch on={settings.sound} label={SETTINGS.sound} onChange={setSound} />
        </div>

        <div className="toggle">
          <div>
            <div>{SETTINGS.animations}</div>
            <div className="faint">{SETTINGS.animationsHint}</div>
          </div>
          <div className="row">
            {(['full', 'reduced', 'off'] as AnimationLevel[]).map((level) => (
              <button
                key={level}
                className={`btn btn-sm ${settings.animations === level ? 'btn-active' : ''}`}
                onClick={() => setAnimations(level)}
              >
                {level === 'full'
                  ? SETTINGS.animationsFull
                  : level === 'reduced'
                    ? SETTINGS.animationsReduced
                    : SETTINGS.animationsOff}
              </button>
            ))}
          </div>
        </div>

        <div className="toggle">
          <span>{SETTINGS.textScale}</span>
          <div className="row">
            {(['small', 'normal', 'large'] as TextScale[]).map((scale) => (
              <button
                key={scale}
                className={`btn btn-sm ${settings.textScale === scale ? 'btn-active' : ''}`}
                onClick={() => setTextScale(scale)}
              >
                {scale === 'small'
                  ? SETTINGS.textScaleSmall
                  : scale === 'large'
                    ? SETTINGS.textScaleLarge
                    : SETTINGS.textScaleNormal}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{SETTINGS.muteList}</DecoHead>
        {settings.mutedSeats.length === 0 ? (
          <p className="muted">{SETTINGS.muteListEmpty}</p>
        ) : (
          settings.mutedSeats.map((seat) => (
            <div className="spread" key={seat}>
              <span>{nameFor(seat)}</span>
              <button className="btn btn-sm" onClick={() => toggleMute(seat)}>
                {SETTINGS.unmute}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
