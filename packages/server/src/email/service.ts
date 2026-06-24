/**
 * Account-lifecycle email composition + dispatch (1920s-noir voice).
 *
 * Wraps the {@link EmailTransport} with the three account emails — password
 * reset, email verification, and a welcome note — and builds their links from
 * `publicBaseUrl`. Every send here is BEST-EFFORT: failures are caught and
 * logged so a dead mail server can never 500 (or block) the request that
 * triggered the send. Callers may `void` these.
 */

import type { ServerConfig } from '../config.js';
import { log } from '../log.js';
import type { EmailMessage, EmailTransport } from './transport.js';

export class EmailService {
  constructor(
    private readonly transport: EmailTransport,
    private readonly cfg: ServerConfig,
  ) {}

  /** Build an absolute link onto the public base URL (already trailing-slash-trimmed). */
  private link(path: string): string {
    return `${this.cfg.publicBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** Send, swallowing + logging any error so the caller is never affected. */
  private async sendSafe(kind: string, msg: EmailMessage): Promise<void> {
    try {
      await this.transport.send(msg);
    } catch (err) {
      log.warn('email send failed (best-effort, ignored)', { kind, to: msg.to, err: String(err) });
    }
  }

  /** Password-reset link (~1h validity). */
  async sendPasswordReset(to: string, token: string): Promise<void> {
    const url = this.link(`/reset?token=${encodeURIComponent(token)}`);
    await this.sendSafe('password_reset', {
      to,
      subject: 'Nocturne — a key to your account',
      text:
        `Someone asked to reset the password on your Nocturne account.\n\n` +
        `If it was you, follow this link within the hour:\n\n${url}\n\n` +
        `If it wasn't, do nothing — the door stays locked and this note can be torn up.\n\n` +
        `— The house at Nocturne`,
    });
  }

  /** Email-verification link (issued at register / on resend). */
  async sendVerification(to: string, token: string): Promise<void> {
    const url = this.link(`/verify-email?token=${encodeURIComponent(token)}`);
    await this.sendSafe('email_verify', {
      to,
      subject: 'Nocturne — confirm your name at the door',
      text:
        `Welcome to Nocturne. Before the family takes your word, confirm this is your address:\n\n` +
        `${url}\n\n` +
        `Didn't open an account here? Then this note found the wrong table — ignore it.\n\n` +
        `— The house at Nocturne`,
    });
  }

  /** Short welcome note (no link required; points to the community). */
  async sendWelcome(to: string, username: string): Promise<void> {
    const url = this.link('/community');
    await this.sendSafe('welcome', {
      to,
      subject: 'Nocturne — pull up a chair',
      text:
        `${username}, you're in.\n\n` +
        `The lamps are low and the table's set. Read the room, trust no one too quickly, ` +
        `and survive the night.\n\n` +
        `When you're ready to talk shop, the parlor's through here:\n${url}\n\n` +
        `— The house at Nocturne`,
    });
  }
}
