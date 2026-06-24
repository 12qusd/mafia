/**
 * Pluggable outbound-email transport (account lifecycle: password reset, email
 * verification, welcome). The rest of the server depends only on the
 * {@link EmailTransport} interface; the concrete transport is chosen at boot by
 * {@link makeEmailTransport} from config.
 *
 * Two implementations satisfy it:
 *   - {@link LogTransport}  — logs the message (used when SMTP is NOT configured,
 *     so every flow is fully functional in dev/unconfigured prod; the operator
 *     just drops in SMTP creds later).
 *   - {@link SmtpTransport} — sends via nodemailer when SMTP_HOST is set.
 *
 * No secrets in code: all SMTP config comes from env via config.ts. Every send
 * is best-effort at the call site (a mail failure must never 500 a request).
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailConfig } from '../config.js';
import { log } from '../log.js';

/** A single outbound message. `html` is optional; `text` is always present. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
}

/**
 * Logs the message instead of sending it. Used when SMTP is not configured so
 * the account flows work end-to-end in dev/unconfigured prod — the operator can
 * read the reset/verify link straight out of the logs. Logs a short body preview
 * plus the first link found (never the full body, to keep log lines bounded).
 */
export class LogTransport implements EmailTransport {
  async send(msg: EmailMessage): Promise<void> {
    log.info('email (log transport — SMTP not configured)', {
      to: msg.to,
      subject: msg.subject,
      preview: bodyPreview(msg.text),
      link: firstLink(msg.text) ?? undefined,
    });
  }
}

/** Sends mail via nodemailer/SMTP. Constructed only when SMTP_HOST is set. */
export class SmtpTransport implements EmailTransport {
  private readonly transporter: Transporter;
  constructor(private readonly cfg: EmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      // STARTTLS on the common submission port (587); implicit TLS on 465.
      secure: cfg.smtpPort === 465,
      ...(cfg.smtpUser
        ? { auth: { user: cfg.smtpUser, pass: cfg.smtpPass ?? '' } }
        : {}),
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    });
  }
}

/**
 * Choose the transport from config: SmtpTransport when SMTP_HOST is set, else
 * LogTransport. Logged once at boot so the operator knows which is live.
 */
export function makeEmailTransport(cfg: EmailConfig): EmailTransport {
  if (cfg.smtpHost) {
    log.info('email: using SMTP transport', { host: cfg.smtpHost, port: cfg.smtpPort });
    return new SmtpTransport(cfg);
  }
  log.info('email: SMTP not configured — using log transport (messages are logged, not sent)');
  return new LogTransport();
}

/** First ~120 chars of the body, whitespace-collapsed, for a bounded log line. */
function bodyPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/** The first http(s) link in the body, or null. */
function firstLink(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export { bodyPreview, firstLink };
