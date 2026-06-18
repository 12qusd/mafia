/**
 * Private night-result log (BUILD_SPEC §13.1 own panel, §6.7/§6.8). Renders the
 * noir wording for each `private_result` this seat received, via the shared
 * string helpers. Only information the server actually delivered is shown
 * (§13.2: render only what the server sent).
 */

import {
  getRole,
  INVESTIGATOR_CLASS_TABLE,
  type InvestigatorClass,
} from '@nocturne/shared';
import { strings } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead } from './common.js';
import type { PrivateResultPayload } from '@nocturne/shared';

export function PrivateLog({ seatNameFor }: { seatNameFor: (seat: number) => string }) {
  const log = useStore((s) => s.privateLog);
  if (log.length === 0) return null;

  const label = (seat: number) => `${seat + 1} · ${seatNameFor(seat)}`;

  return (
    <div className="panel panel-pad stack">
      <DecoHead>Your notes</DecoHead>
      {log.map((entry) => (
        <div key={entry.id} className="chat-line">
          <span className="faint">N{entry.dayNumber} </span>
          {renderPayload(entry.payload, label)}
        </div>
      ))}
    </div>
  );
}

function renderPayload(p: PrivateResultPayload, label: (seat: number) => string): string {
  switch (p.kind) {
    case 'sheriff_result':
      return strings.sheriffResultLine(label(p.target), p.result);
    case 'investigator_result':
      return strings.investigatorResultLine(
        label(p.target),
        rolesForClass(p.resultClass),
      );
    case 'consigliere_result':
      return strings.consigliereResultLine(label(p.target), getRole(p.role).name);
    case 'janitor_result':
      return strings.janitorResultLine(label(p.target), getRole(p.role).name);
    case 'lookout_result':
      return strings.lookoutResultLine(label(p.target), p.visitors.map(label));
    case 'roleblocked':
    case 'block_failed':
    case 'target_unreachable':
    case 'attacked_survived':
    case 'was_attacked':
    case 'was_healed':
    case 'jailed':
    case 'blackmailed':
      return strings.PRIVATE_RESULT_TEXT[p.kind];
    default:
      return '';
  }
}

function rolesForClass(cls: InvestigatorClass): string[] {
  return (INVESTIGATOR_CLASS_TABLE[cls] ?? []).map((r) => getRole(r).name);
}
