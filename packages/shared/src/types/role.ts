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
  'DISGUISER',
  'ARSONIST',
  // --- Role-expansion batch C ---
  'CRUSADER',
  'AMBUSHER',
  'PSYCHIC',
  'HYPNOTIST',
  // --- Role-expansion batch D (iconic neutrals) ---
  'WEREWOLF',
  'MASS_MURDERER',
  'GUARDIAN_ANGEL',
  'JUGGERNAUT',
  // --- Triad faction (second evil killing faction) ---
  'DRAGON_HEAD',
  'ENFORCER',
  'VANGUARD',
  // --- Role-expansion batch E (complex neutrals / conversions) ---
  'WITCH', // Neutral spoiler: controls a puppet onto a victim; rides any non-Town win
  'PIRATE', // Neutral benign-ish: duels a target, plunders for a personal win
  'PLAGUEBEARER', // Neutral Killing: infects via visits; transforms into Pestilence
  'PESTILENCE', // Neutral Killing: the Plaguebearer's powerful rampaging final form
  // --- Vampire conversion faction (third evil killing faction) ---
  'VAMPIRE', // Vampire: bites at night to CONVERT a victim into a new Vampire
  'VAMPIRE_HUNTER', // Town: stakes any vampire that bites them; becomes a Vigilante when no vampires remain
  // --- Cult conversion faction (fourth evil faction) ---
  'CULT_LEADER', // Cult: the unique converter — recruits one victim per night (one-night cooldown); recruitment stops if it dies
  'CULTIST', // Cult: the converted body of the faction; swells the parity count but cannot itself recruit
  // --- Role-expansion batch F (distinct-mechanic Town roles) ---
  'TRANSPORTER', // Town support: swaps two seats, redirecting everything aimed at one onto the other (the "bus driver")
  'CORONER', // Town investigative: autopsies a dead player — learns their role + who visited them the night they died
  'TRAPPER', // Town protective: arms a trap at a target — shields one basic attack AND names a caught visitor's seat (does not kill)
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
