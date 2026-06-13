/**
 * Server-side rate limiters (BUILD_SPEC §6.4, §11.5).
 *
 * Sliding-window counters, all enforced server-side and never trusting the
 * client. Limits come from `@nocturne/shared` constants:
 *   - connection: 20 msgs / 10 s per socket (§11.5)
 *   - chat: 5 msgs / 10 s per channel (§6.4)
 *   - whisper: 1 / 3 s (§6.4)
 *
 * A clock is injected so tests are deterministic.
 */

import {
  SOCKET_RATE_MAX_MESSAGES,
  SOCKET_RATE_WINDOW_MS,
  CHAT_RATE_MAX_MESSAGES,
  CHAT_RATE_WINDOW_MS,
  WHISPER_MIN_INTERVAL_MS,
} from '@nocturne/shared';

export type Clock = () => number;

/** Sliding-window limiter: at most `max` events per `windowMs`. */
export class SlidingWindow {
  private readonly events: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  /** Returns true if allowed (and records the event), false if over the limit. */
  tryAcquire(): boolean {
    const t = this.now();
    const cutoff = t - this.windowMs;
    while (this.events.length > 0 && (this.events[0] as number) <= cutoff) this.events.shift();
    if (this.events.length >= this.max) return false;
    this.events.push(t);
    return true;
  }
}

/** Minimum-interval limiter (whispers): at least `intervalMs` between events. */
export class MinInterval {
  private last = -Infinity;
  constructor(
    private readonly intervalMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  tryAcquire(): boolean {
    const t = this.now();
    if (t - this.last < this.intervalMs) return false;
    this.last = t;
    return true;
  }
}

/** Connection-level limiter (§11.5). */
export function makeSocketLimiter(now: Clock = Date.now): SlidingWindow {
  return new SlidingWindow(SOCKET_RATE_MAX_MESSAGES, SOCKET_RATE_WINDOW_MS, now);
}

/**
 * Per-(channel) chat limiter set for one identity (§6.4). Lazily creates a
 * window per channel key.
 */
export class ChatLimiter {
  private readonly perChannel = new Map<string, SlidingWindow>();
  private readonly whisper: MinInterval;
  constructor(private readonly now: Clock = Date.now) {
    this.whisper = new MinInterval(WHISPER_MIN_INTERVAL_MS, now);
  }

  tryChat(channel: string): boolean {
    let w = this.perChannel.get(channel);
    if (!w) {
      w = new SlidingWindow(CHAT_RATE_MAX_MESSAGES, CHAT_RATE_WINDOW_MS, this.now);
      this.perChannel.set(channel, w);
    }
    return w.tryAcquire();
  }

  tryWhisper(): boolean {
    return this.whisper.tryAcquire();
  }
}
