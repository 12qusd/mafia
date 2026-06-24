/**
 * "How to Play" guide (retention front-end). A readable noir primer: the
 * premise, the sides at a high level, the day→trial→execution→night loop,
 * voting & trials, win conditions, and a brief note on standing/ranked/unlocks.
 * Role specifics live in the Glossary ("The Cast") — we link there rather than
 * duplicate every role card.
 *
 * Static content (no user-derived text), so nothing here needs sanitizing.
 */

import { Link } from 'react-router-dom';
import { strings } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead } from '../components/common.js';
import { HOWTO } from '../lib/strings-extra.js';
import { loadToken } from '../lib/storage.js';
import { quickPlay } from '../ws/actions.js';

export function HowToPlayScreen() {
  const guestId = useStore((s) => s.guestId);
  const userId = useStore((s) => s.userId);
  const connection = useStore((s) => s.connection);
  const ready = connection === 'open' && !!(guestId || userId || loadToken());

  return (
    <div className="page stack howto">
      <div className="hero">
        <h1>{HOWTO.heading}</h1>
        <p>{HOWTO.sub}</p>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{HOWTO.premiseHeading}</DecoHead>
        <p>{HOWTO.premise}</p>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{HOWTO.factionsHeading}</DecoHead>
        <div className="howto-factions">
          {HOWTO.factions.map((f) => (
            <div className="howto-faction" key={f.name}>
              <strong>{f.name}</strong>
              <p className="muted">{f.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{HOWTO.loopHeading}</DecoHead>
        <ol className="howto-loop">
          {HOWTO.loopSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="grid-2">
        <div className="panel panel-pad stack">
          <DecoHead>{HOWTO.votingHeading}</DecoHead>
          <p>{HOWTO.voting}</p>
        </div>
        <div className="panel panel-pad stack">
          <DecoHead>{HOWTO.winHeading}</DecoHead>
          <p>{HOWTO.win}</p>
        </div>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{HOWTO.progressHeading}</DecoHead>
        <p>{HOWTO.progress}</p>
      </div>

      <div className="panel panel-pad stack">
        <DecoHead>{HOWTO.castHeading}</DecoHead>
        <p>{HOWTO.castBlurb}</p>
        {/* The full role cards live in the topbar "Roles" glossary; this routes
            home where that control sits, keeping role text in one place. */}
        <Link className="linkbtn" to="/" title={HOWTO.castLink}>
          {HOWTO.castLink}
        </Link>
      </div>

      <div className="row">
        <button
          className="btn btn-primary"
          disabled={!ready}
          title={strings.UI.appName}
          onClick={() => quickPlay()}
        >
          {HOWTO.cta}
        </button>
        <Link className="btn" to="/">
          {HOWTO.back}
        </Link>
      </div>
    </div>
  );
}
