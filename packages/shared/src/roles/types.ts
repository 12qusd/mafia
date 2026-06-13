import type { RoleId, InvestigatorClass, SheriffResult } from '../types/role.js';
import type { Faction } from '../types/faction.js';

/**
 * Role data model (BUILD_SPEC §6.5, §6.6). Pure data — no logic. The engine
 * reads these descriptors; `shared` never resolves abilities.
 */

/**
 * The kind of night action a role submits.
 *
 * - none        — no night action (Citizen, Mayor, Jester).
 * - investigate — produces information (Sheriff, Investigator, Lookout).
 * - protect     — shields a target from a kill (Doctor; Survivor self-vest).
 * - roleblock   — cancels a target's night action (Escort, Consort).
 * - kill        — attempts to kill a target (Vigilante, Mafioso, Serial Killer;
 *                 Godfather when personally performing the kill).
 * - frame       — alters how a target reads to investigators (Framer).
 * - control     — directs the faction kill without visiting (Godfather).
 */
export type NightActionKind =
  | 'none'
  | 'investigate'
  | 'protect'
  | 'roleblock'
  | 'kill'
  | 'frame'
  | 'control';

/**
 * The kind of day action a role may take (BUILD_SPEC §9.1 `day_ability`).
 *
 * - none    — no day action.
 * - jail    — Jailor selects a prisoner to jail for the coming night.
 * - reveal  — Mayor reveals publicly (vote weight → 3).
 */
export type DayActionKind = 'none' | 'jail' | 'reveal';

/** Who a night action may target. */
export type TargetScope =
  | 'none' // no target (passive / self-only handled separately)
  | 'others' // any living seat other than self
  | 'others_or_self' // any living seat including self
  | 'self'; // self only (e.g. Survivor vest)

/** Limited-use ability bookkeeping (BUILD_SPEC §6.5). */
export interface AbilityUses {
  /** Total uses available across the match (e.g. Vigilante 2 bullets). */
  total: number;
  /** Optional sub-limit for self-targeting (e.g. Doctor 1 self-heal). */
  selfTotal?: number;
}

/** Full descriptor for a single role. */
export interface RoleDefinition {
  id: RoleId;
  /** Player-facing role name (also the generic dictionary name). */
  name: string;
  faction: Faction;

  // --- Ability metadata -----------------------------------------------------
  nightAction: NightActionKind;
  dayAction: DayActionKind;
  targetScope: TargetScope;
  /** Limited uses, if the ability is metered; omitted for unlimited/passive. */
  uses?: AbilityUses;

  // --- Identity / setup constraints ----------------------------------------
  /** Role may appear at most once per setup (Jailor, Mayor, Godfather). */
  unique: boolean;

  // --- Combat / interaction flags ------------------------------------------
  /** Survives normal night kills (not Jailor executions) (§6.5, §6.7). */
  nightImmune: boolean;
  /** Cannot be roleblocked by Escort/Consort; jail still blocks (§6.7). */
  roleblockImmune: boolean;
  /**
   * Whether acting on a target counts as a visit the Lookout can see (§6.5).
   * `false` for passive/self/controlling roles (e.g. Godfather control,
   * Citizen, Mayor). Doctor/Escort/etc. visit. The Godfather visits only when
   * personally performing the kill — represented as a separate kill role state
   * by the engine, not here.
   */
  visits: boolean;

  // --- Investigation results (§6.6) ----------------------------------------
  /** Sheriff reads this role as suspicious / not suspicious (un-framed). */
  sheriffResult: SheriffResult;
  /** Investigator result class for this role (un-framed). */
  investigatorClass: InvestigatorClass;

  // --- Player-facing copy (ORIGINAL noir text, §2.1.2) ----------------------
  /** One-line tagline shown on the role card. */
  tagline: string;
  /** Full role description (mechanics in original wording). */
  description: string;
  /** Win-condition summary shown on the role card. */
  winHint: string;
}
