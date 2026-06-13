/**
 * Moderation service (BUILD_SPEC §11).
 *
 * Reports (server snapshots chat context at submission), per-account mutes
 * (server-enforced delivery suppression), and the sanctions ladder. Profanity
 * filtering lives in `text.ts`. Ban/mute checks happen at login/lobby-join
 * (identity service) and message delivery (mutes), never in a tight loop.
 */

import type { ReportCategory, SeatId } from '@nocturne/shared';
import type { Store, SanctionType } from '../db/index.js';
import { log } from '../log.js';

export interface ChatContextEntry {
  channel: string;
  from: SeatId | 'Jailor';
  text: string;
  ts: number;
}

export class Moderation {
  /** identity id → set of muted identity ids, cached for hot-path delivery. */
  private readonly muteCache = new Map<string, Set<string>>();

  constructor(private readonly store: Store) {}

  /**
   * Submit a report (§11.1). Snapshots the provided chat context into the
   * evidence column. Dedupe per (target, match) handled by the store.
   */
  async report(input: {
    reporter: string;
    targetUser: string;
    matchId: string | null;
    category: ReportCategory;
    comment: string | null;
    chatContext: ChatContextEntry[];
  }): Promise<{ deduped: boolean }> {
    const res = await this.store.insertReport({
      reporter: input.reporter,
      targetUser: input.targetUser,
      matchId: input.matchId,
      category: input.category,
      comment: input.comment,
      evidence: { chat: input.chatContext.slice(-50) },
    });
    if (!res.deduped) log.info('report filed', { target: input.targetUser, category: input.category });
    return res;
  }

  // --- Mutes (§11.2) -------------------------------------------------------

  async loadMutes(identityId: string): Promise<Set<string>> {
    let set = this.muteCache.get(identityId);
    if (set) return set;
    const ids = await this.store.getMutes(identityId);
    set = new Set(ids);
    this.muteCache.set(identityId, set);
    return set;
  }

  async setMute(muterId: string, mutedId: string, on: boolean): Promise<void> {
    await this.store.setMute(muterId, mutedId, on);
    const set = this.muteCache.get(muterId) ?? new Set<string>();
    if (on) set.add(mutedId);
    else set.delete(mutedId);
    this.muteCache.set(muterId, set);
  }

  /** True if `muterId` has muted `senderId` (cached; server-enforced delivery). */
  isMuted(muterId: string, senderId: string): boolean {
    return this.muteCache.get(muterId)?.has(senderId) ?? false;
  }

  // --- Sanctions ladder (§11.3) --------------------------------------------

  async applySanction(input: {
    userId: string;
    type: SanctionType;
    reason: string | null;
    reportId: string | null;
    issuedBy: string;
    durationMs?: number;
  }): Promise<void> {
    const expiresAt =
      input.durationMs && (input.type === 'mute' || input.type === 'temp_ban')
        ? Date.now() + input.durationMs
        : null;
    await this.store.applySanction({
      userId: input.userId,
      type: input.type,
      reason: input.reason,
      reportId: input.reportId,
      issuedBy: input.issuedBy,
      ...(expiresAt !== null ? { expiresAt } : { expiresAt: null }),
    });
    await this.store.logAdminAction(input.issuedBy, 'apply_sanction', {
      userId: input.userId,
      type: input.type,
    });
  }

  listReports(status?: string) {
    return this.store.listReports(status);
  }
  listSanctions(userId?: string) {
    return this.store.listSanctions(userId);
  }
}
