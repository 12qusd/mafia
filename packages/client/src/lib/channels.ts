/**
 * Which chat channels the local seat may currently READ/see tabs for
 * (BUILD_SPEC §6.4 entitlements). The client renders a tab when it has actually
 * received messages on that channel OR the channel is contextually live for the
 * seat — but per §13.2 we never fabricate entitlements: the authoritative gate
 * is server-side delivery. This helper only decides which tabs to *offer*.
 *
 * Day is always offered during day phases. Mafia/Jail/Dead/Whisper tabs appear
 * when the seat is in that state or has received traffic there.
 */

import type { ChatChannel, Phase } from '@nocturne/shared';
import type { ChatLine } from '../store/types.js';

export interface ChannelContext {
  phase: Phase;
  alive: boolean;
  spectator: boolean;
  isMafia: boolean;
  /** Whether the local seat is a member of the Triad (second evil faction). */
  isTriad: boolean;
  /** Whether the local seat is the Jailor (drives the jailor side of the cell). */
  isJailor: boolean;
  /**
   * The Jailor's selected prisoner for the coming night (`own.jailTarget`), or
   * null. Non-null at NIGHT means a jailing is in effect for the Jailor.
   */
  jailTarget: number | null;
  /** True when the local seat is tonight's prisoner (a `jailed` result arrived). */
  jailedThisNight: boolean;
  /** True when the local seat is silenced in day chat (a `blackmailed` result). */
  silencedToday: boolean;
  chat: ChatLine[];
}

const DAY_PHASES: ReadonlySet<Phase> = new Set([
  'DAY_0',
  'DAWN',
  'DAY_DISCUSSION',
  'DAY_VOTING',
  'TRIAL_DEFENSE',
  'TRIAL_JUDGMENT',
  'EXECUTION',
]);

export function entitledChannels(ctx: ChannelContext): ChatChannel[] {
  const seen = new Set<ChatChannel>();
  for (const l of ctx.chat) seen.add(l.channel);

  const out: ChatChannel[] = [];

  // Day channel: visible to everyone during the game (read for all; write gated
  // separately). Always offer it once a game is underway.
  out.push('day');

  // Mafia: only if the seat has received mafia traffic (server only sends mafia
  // chat to mafia seats, §5) or it's a known-mafia seat at night.
  if (seen.has('mafia') || (ctx.isMafia && ctx.phase === 'NIGHT')) out.push('mafia');

  // Triad: the Mafia channel's mirror for the second evil faction.
  if (seen.has('triad') || (ctx.isTriad && ctx.phase === 'NIGHT')) out.push('triad');

  // Jail: at NIGHT for the two parties of a jailing — the Jailor (once a
  // prisoner is set) and that prisoner — so EITHER side can open the cell before
  // a single line has been spoken. Also shown once jail traffic has arrived.
  const jailorTonight = ctx.isJailor && ctx.jailTarget !== null;
  if (
    seen.has('jail') ||
    (ctx.phase === 'NIGHT' && ctx.alive && (jailorTonight || ctx.jailedThisNight))
  ) {
    out.push('jail');
  }

  // Dead: strictly dead-only (GAME RULE: death is permanent; no LIVING player may
  // contact the dead). Offered only to actually-DEAD seats (or when dead traffic
  // has already arrived, which the server delivers to dead seats alone).
  if (seen.has('dead') || (!ctx.alive && !ctx.spectator)) out.push('dead');

  // Whisper: shown if any whisper has arrived.
  if (seen.has('whisper')) out.push('whisper');

  return out;
}

/** Can the local seat WRITE in the given channel right now (§6.4)? */
export function canSpeakIn(channel: ChatChannel, ctx: ChannelContext): boolean {
  if (ctx.spectator) return false;
  switch (channel) {
    case 'day':
      // Living seats write during day phases — unless silenced (blackmailed).
      return ctx.alive && DAY_PHASES.has(ctx.phase) && !ctx.silencedToday;
    case 'mafia':
      return ctx.alive && ctx.isMafia && ctx.phase === 'NIGHT';
    case 'triad':
      return ctx.alive && ctx.isTriad && ctx.phase === 'NIGHT';
    case 'jail':
      // Only the two parties of an active jailing speak in the cell, at NIGHT.
      return (
        ctx.alive &&
        ctx.phase === 'NIGHT' &&
        ((ctx.isJailor && ctx.jailTarget !== null) || ctx.jailedThisNight)
      );
    case 'dead':
      // Strictly dead-only: a living seat can never speak with the dead.
      return !ctx.alive;
    case 'whisper':
      return ctx.alive && DAY_PHASES.has(ctx.phase) && !ctx.silencedToday;
    default:
      return false;
  }
}

/**
 * Why the local seat cannot write in `channel` right now — used to pick the
 * correct disabled-input copy in the ChatPane (BUILD_SPEC §13.1). Returns null
 * when the seat CAN speak. The reason is the most specific true cause:
 *  - 'spectator'  → an onlooker (never speaks);
 *  - 'silenced'   → blackmailed in day chat this cycle;
 *  - 'dead'       → a dead seat looking at a non-dead channel;
 *  - 'phase'      → living, but this channel/phase grants no voice right now.
 */
export type MuteReason = 'spectator' | 'silenced' | 'dead' | 'phase';

export function muteReasonFor(channel: ChatChannel, ctx: ChannelContext): MuteReason | null {
  if (canSpeakIn(channel, ctx)) return null;
  if (ctx.spectator) return 'spectator';
  // A silenced (blackmailed) living seat in a day-writable channel.
  if (
    ctx.alive &&
    ctx.silencedToday &&
    (channel === 'day' || channel === 'whisper') &&
    DAY_PHASES.has(ctx.phase)
  ) {
    return 'silenced';
  }
  // Dead, looking at a channel that is not the dead channel.
  if (!ctx.alive && channel !== 'dead') return 'dead';
  // Otherwise: a living seat with no voice in this channel/phase right now.
  return 'phase';
}
