/**
 * Custom setups route (goal 4). A thin page wrapper around the
 * CustomSetupBuilder, which handles the registered-vs-guest gating itself.
 */

import { CustomSetupBuilder } from '../components/CustomSetupBuilder.js';
import { BUILDER } from '../lib/strings-extra.js';

export function SetupsScreen() {
  return (
    <div className="page stack">
      <div className="hero" style={{ paddingBottom: 8 }}>
        <h1>{BUILDER.heading}</h1>
        <p>{BUILDER.sub}</p>
      </div>
      <CustomSetupBuilder />
    </div>
  );
}
