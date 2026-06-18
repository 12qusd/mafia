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

  // Jail: only when jail traffic has arrived (jailor or prisoner).
  if (seen.has('jail')) out.push('jail');

  // Dead: for dead seats / spectators-with-dead (server-gated), shown when the
  // seat is dead or has received dead traffic.
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
      // Living seats write during day phases.
      return ctx.alive && DAY_PHASES.has(ctx.phase);
    case 'mafia':
      return ctx.alive && ctx.isMafia && ctx.phase === 'NIGHT';
    case 'triad':
      return ctx.alive && ctx.isTriad && ctx.phase === 'NIGHT';
    case 'jail':
      return ctx.phase === 'NIGHT';
    case 'dead':
      return !ctx.alive;
    case 'whisper':
      return ctx.alive && DAY_PHASES.has(ctx.phase);
    default:
      return false;
  }
}
