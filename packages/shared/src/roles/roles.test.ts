import { describe, it, expect } from 'vitest';
import {
  ROLES,
  ALL_ROLES,
  INVESTIGATOR_CLASS_TABLE,
  FRAMED_INVESTIGATOR_CLASS,
  UNIQUE_ROLES,
  getRole,
} from './index.js';
import { ROLE_IDS, type RoleId } from '../types/role.js';

describe('role registry integrity (§6.5)', () => {
  it('defines all roles (17 MVP + batch-A expansion)', () => {
    expect(ALL_ROLES).toHaveLength(ROLE_IDS.length);
    expect(Object.keys(ROLES)).toHaveLength(ROLE_IDS.length);
  });

  it('every RoleId enum value has a definition with a matching id', () => {
    for (const id of ROLE_IDS) {
      const role = getRole(id);
      expect(role.id).toBe(id);
    }
  });

  it('original copy fields are present and non-trivial', () => {
    for (const role of ALL_ROLES) {
      expect(role.name.length).toBeGreaterThan(0);
      expect(role.tagline.length).toBeGreaterThan(0);
      expect(role.description.length).toBeGreaterThan(40);
      expect(role.winHint.length).toBeGreaterThan(0);
    }
  });
});

describe('unique roles (§6.5, §6.10)', () => {
  it('exactly Jailor, Mayor, Godfather, Serial Killer are unique', () => {
    // Jailor, Mayor, Godfather per §6.10; Serial Killer is one-per-setup in MVP (§6.9).
    expect([...UNIQUE_ROLES].sort()).toEqual(
      ['GODFATHER', 'JAILOR', 'MAYOR', 'SERIAL_KILLER'].sort(),
    );
  });

  it('the unique flag matches the UNIQUE_ROLES list', () => {
    for (const role of ALL_ROLES) {
      expect(role.unique).toBe(UNIQUE_ROLES.includes(role.id));
    }
  });
});

describe('investigator result classes (§6.6)', () => {
  // The exact table from §6.6.
  const SPEC_TABLE: Record<string, RoleId[]> = {
    R1: ['CITIZEN', 'SURVIVOR', 'EXECUTIONER'],
    R2: ['SHERIFF', 'JAILOR', 'BLACKMAILER'],
    R3: ['INVESTIGATOR', 'JESTER', 'CONSIGLIERE'],
    R4: ['DOCTOR', 'SERIAL_KILLER'],
    R5: ['ESCORT', 'CONSORT', 'JANITOR'],
    R6: ['VIGILANTE', 'MAFIOSO', 'VETERAN'],
    R7: ['GODFATHER', 'MAYOR', 'BODYGUARD'],
    R8: ['FRAMER', 'LOOKOUT', 'FORGER'],
  };

  it('the class table matches §6.6 exactly', () => {
    for (const [cls, roles] of Object.entries(SPEC_TABLE)) {
      expect(
        [...INVESTIGATOR_CLASS_TABLE[cls as keyof typeof INVESTIGATOR_CLASS_TABLE]].sort(),
      ).toEqual([...roles].sort());
    }
  });

  it("each role's investigatorClass agrees with the table", () => {
    for (const role of ALL_ROLES) {
      const cls = role.investigatorClass;
      expect(INVESTIGATOR_CLASS_TABLE[cls]).toContain(role.id);
    }
  });

  it('every role appears in exactly one class', () => {
    const seen = new Map<RoleId, number>();
    for (const roles of Object.values(INVESTIGATOR_CLASS_TABLE)) {
      for (const r of roles) seen.set(r, (seen.get(r) ?? 0) + 1);
    }
    for (const id of ROLE_IDS) {
      expect(seen.get(id)).toBe(1);
    }
  });

  it('framed targets report R6 (contains Mafioso, §6.5 #13)', () => {
    expect(FRAMED_INVESTIGATOR_CLASS).toBe('R6');
    expect(INVESTIGATOR_CLASS_TABLE.R6).toContain('MAFIOSO');
  });
});

describe('sheriff alignment table (§6.6)', () => {
  // suspicious = {Mafioso, Consort, Framer, Consigliere, Blackmailer, Serial Killer}
  // (framed targets handled by the engine).
  const SUSPICIOUS: RoleId[] = [
    'MAFIOSO',
    'CONSORT',
    'FRAMER',
    'CONSIGLIERE',
    'BLACKMAILER',
    'SERIAL_KILLER',
  ];

  it('exactly the spec set reads suspicious un-framed', () => {
    for (const role of ALL_ROLES) {
      const expected = SUSPICIOUS.includes(role.id) ? 'suspicious' : 'not_suspicious';
      expect(role.sheriffResult).toBe(expected);
    }
  });

  it('Godfather reads not suspicious (§6.6)', () => {
    expect(ROLES.GODFATHER.sheriffResult).toBe('not_suspicious');
  });

  it('Jester, Executioner, Survivor read not suspicious (§6.6)', () => {
    expect(ROLES.JESTER.sheriffResult).toBe('not_suspicious');
    expect(ROLES.EXECUTIONER.sheriffResult).toBe('not_suspicious');
    expect(ROLES.SURVIVOR.sheriffResult).toBe('not_suspicious');
  });
});

describe('ability metadata (§6.5)', () => {
  it('limited-use roles carry the right totals', () => {
    expect(ROLES.VIGILANTE.uses?.total).toBe(2);
    expect(ROLES.JAILOR.uses?.total).toBe(2);
    expect(ROLES.SURVIVOR.uses?.total).toBe(4);
    expect(ROLES.DOCTOR.uses?.selfTotal).toBe(1);
    expect(ROLES.JANITOR.uses?.total).toBe(3);
    expect(ROLES.VETERAN.uses?.total).toBe(3);
  });

  it('night-immune roles are flagged (§6.5)', () => {
    const immune = ALL_ROLES.filter((r) => r.nightImmune)
      .map((r) => r.id)
      .sort();
    expect(immune).toEqual(['EXECUTIONER', 'GODFATHER', 'SERIAL_KILLER'].sort());
  });

  it('roleblock-immune is only the Godfather (§6.5; SK handled by hazard rule)', () => {
    const rbImmune = ALL_ROLES.filter((r) => r.roleblockImmune).map((r) => r.id);
    expect(rbImmune).toEqual(['GODFATHER']);
  });

  it('Mafia faction has exactly the mafia roles (core + batch-A support)', () => {
    const mafia = ALL_ROLES.filter((r) => r.faction === 'MAFIA')
      .map((r) => r.id)
      .sort();
    expect(mafia).toEqual(
      [
        'BLACKMAILER',
        'CONSIGLIERE',
        'CONSORT',
        'FORGER',
        'FRAMER',
        'GODFATHER',
        'JANITOR',
        'MAFIOSO',
      ].sort(),
    );
  });
});
