import { z } from 'zod';

/**
 * Role identifiers (BUILD_SPEC §6.5, extended in role-expansion batch A).
 *
 * Generic, dictionary-word / real-mafia-terminology names only — no coined
 * names from the source games (§2.1.3). The first 17 are the MVP set; the
 * remainder are the batch-A expansion (Consigliere, Forger, Janitor, Bodyguard,
 * Blackmailer, Veteran) ported from the SC2Mafia lineage with original copy.
 */
export const ROLE_IDS = [
  'CITIZEN',
  'SHERIFF',
  'INVESTIGATOR',
  'LOOKOUT',
  'DOCTOR',
  'ESCORT',
  'JAILOR',
  'VIGILANTE',
  'MAYOR',
  'GODFATHER',
  'MAFIOSO',
  'CONSORT',
  'FRAMER',
  'SERIAL_KILLER',
  'JESTER',
  'EXECUTIONER',
  'SURVIVOR',
  // --- Role-expansion batch A ---
  'CONSIGLIERE',
  'FORGER',
  'JANITOR',
  'BODYGUARD',
  'BLACKMAILER',
  'VETERAN',
  // --- Role-expansion batch B ---
  'TRACKER',
  'SPY',
  'AMNESIAC',
  'MEDIUM',
  'DISGUISER',
  'ARSONIST',
] as const;

export const RoleIdSchema = z.enum(ROLE_IDS);

/** A role identifier. */
export type RoleId = z.infer<typeof RoleIdSchema>;

/**
 * Investigator result classes (BUILD_SPEC §6.6). Each class deliberately mixes
 * Town with non-Town roles so a single check never fully confirms an alignment.
 */
export const INVESTIGATOR_CLASSES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'] as const;
export const InvestigatorClassSchema = z.enum(INVESTIGATOR_CLASSES);
export type InvestigatorClass = z.infer<typeof InvestigatorClassSchema>;

/** Sheriff check outcomes (BUILD_SPEC §6.6). */
export const SHERIFF_RESULTS = ['suspicious', 'not_suspicious'] as const;
export const SheriffResultSchema = z.enum(SHERIFF_RESULTS);
export type SheriffResult = z.infer<typeof SheriffResultSchema>;
