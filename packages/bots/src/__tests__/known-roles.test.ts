/**
 * Leak-auditor role-coverage guard (server-hardening Task F).
 *
 * The leak auditor (§5, §12.3) recognizes a role string in a frame only if that
 * id is in `KNOWN_ROLES`. If a future role is added to `@nocturne/shared` but not
 * to `KNOWN_ROLES`, the cross-capture deep scan would silently fail to flag an
 * accidental broadcast of that role's id. This test fails the build the moment
 * coverage drifts, so the auditor can never fall behind the role roster.
 */

import { describe, it, expect } from 'vitest';
import { ALL_ROLES } from '@nocturne/shared';
import { KNOWN_ROLES } from '../leak.js';

describe('leak auditor role coverage (§5, §12.3 — Task F)', () => {
  it('KNOWN_ROLES covers every RoleId in ALL_ROLES', () => {
    const missing = ALL_ROLES.map((r) => r.id).filter((id) => !KNOWN_ROLES.has(id));
    expect(missing, `KNOWN_ROLES is missing role ids: ${missing.join(', ')}`).toEqual([]);
  });

  it('KNOWN_ROLES has no stale ids absent from ALL_ROLES', () => {
    const all = new Set(ALL_ROLES.map((r) => r.id));
    const stale = [...KNOWN_ROLES].filter((id) => !all.has(id));
    expect(stale, `KNOWN_ROLES has stale ids not in ALL_ROLES: ${stale.join(', ')}`).toEqual([]);
  });
});
