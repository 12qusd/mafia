import { describe, it, expect } from 'vitest';
import { ERROR_TEXT, PRIVATE_RESULT_TEXT, deathLine, sheriffResultLine } from './strings.js';
import { ERROR_CODES } from './protocol/errors.js';
import { PRIVATE_RESULT_KINDS } from './protocol/enums.js';
import { DEATH_CAUSES } from './types/death.js';
import { GAME_NAME, PROTOCOL_VERSION } from './constants.js';

describe('strings coverage (§13.2)', () => {
  it('has a message for every error code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TEXT[code]).toBeTruthy();
    }
  });

  it('has an entry for every private-result kind', () => {
    for (const kind of PRIVATE_RESULT_KINDS) {
      // These kinds are resolved by dedicated functions and intentionally blank here.
      const dynamic = [
        'sheriff_result',
        'investigator_result',
        'consigliere_result',
        'janitor_result',
        'lookout_result',
        'tracker_result',
        'spy_result',
        'remember_result',
        'psychic_vision',
        'vampire_hunter_result',
        'coroner_result',
        'trapper_result',
      ];
      if (dynamic.includes(kind)) {
        expect(PRIVATE_RESULT_TEXT[kind]).toBe('');
      } else {
        expect(PRIVATE_RESULT_TEXT[kind].length).toBeGreaterThan(0);
      }
    }
  });

  it('produces a death line for every cause', () => {
    for (const cause of DEATH_CAUSES) {
      const line = deathLine(cause, 'Seat 3', 'Doctor');
      expect(line).toContain('Seat 3');
      expect(line).toContain('Doctor');
    }
  });

  it('sheriff line varies by verdict', () => {
    expect(sheriffResultLine('Seat 2', 'suspicious')).toContain('suspicious');
    expect(sheriffResultLine('Seat 2', 'not_suspicious')).toContain('not suspicious');
  });
});

describe('constants', () => {
  it('exposes GAME_NAME and protocol version', () => {
    expect(GAME_NAME).toBe('Nocturne');
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
