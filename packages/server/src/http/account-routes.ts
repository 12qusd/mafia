/**
 * Account-lifecycle HTTP routes (retention wave): password reset + email
 * verification. All flows are ACCOUNT-only — they gate on
 * `ctx.store.persistent`, so under NO_DB they are inert (503 / no-op) and the
 * test suite is unaffected. Tokens are random; only their hash is stored.
 *
 * No-enumeration posture: `/api/password/forgot` always returns 200 regardless
 * of whether the identifier resolves to an account. Sends are best-effort (the
 * EmailService swallows mail failures), so a dead mail server never 500s a flow.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GatewayContext } from '../ws/context.js';
import { hashToken, newSessionToken } from '../ids.js';
import { hashPassword } from '../auth/passwords.js';
import { clientIp, type RouteLimit } from './rate-limit.js';
import { readToken } from './auth-routes.js';

/** Reset-token validity (1h). Verification tokens get a longer window (24h). */
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const ForgotBody = z.object({ identifier: z.string().min(1).max(254) });
const ResetBody = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(200),
});
const VerifyBody = z.object({ token: z.string().min(1).max(256) });

export function registerAccountRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  // ~5 forgot/resend requests per 15 min per IP (account flows are low-volume).
  const accountLimit: RouteLimit = { max: 5, windowMs: 15 * 60_000 };
  const forgotLimit = ctx.rateLimit(accountLimit);
  const resendLimit = ctx.rateLimit(accountLimit);

  // POST /api/password/forgot — always 200 (no account enumeration). When the
  // identifier (username OR email) resolves to a user, issue a reset link.
  app.post('/api/password/forgot', async (req, reply) => {
    if (forgotLimit(clientIp(req), reply)) return reply;
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = ForgotBody.safeParse(req.body);
    // Even a malformed identifier returns 200 — never reveal anything.
    if (!parsed.success) return reply.send({ ok: true });
    const identifier = parsed.data.identifier.trim();
    const user =
      (await ctx.store.getUserByUsername(identifier)) ??
      (identifier.includes('@') ? await ctx.store.getUserByEmail(identifier) : null);
    if (user && user.email) {
      const token = newSessionToken();
      const tokenHash = hashToken(token, ctx.cfg.sessionSecret);
      await ctx.store.createPasswordReset(user.id, tokenHash, Date.now() + RESET_TTL_MS);
      void ctx.email.sendPasswordReset(user.email, token);
    }
    return reply.send({ ok: true });
  });

  // POST /api/password/reset — validate the token, set the new password, revoke
  // the token + all of the user's sessions (logs out other devices).
  app.post('/api/password/reset', async (req, reply) => {
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = ResetBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_or_expired' });
    const tokenHash = hashToken(parsed.data.token, ctx.cfg.sessionSecret);
    const row = await ctx.store.getPasswordReset(tokenHash);
    if (!row || row.used || row.expiresAt <= Date.now()) {
      return reply.code(400).send({ error: 'invalid_or_expired' });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await ctx.store.updateUserPassword(row.userId, passwordHash);
    await ctx.store.markPasswordResetUsed(tokenHash);
    await ctx.store.revokeAllSessions(row.userId);
    return reply.send({ ok: true });
  });

  // POST /api/email/verify — consume the token + mark the email verified.
  app.post('/api/email/verify', async (req, reply) => {
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_or_expired' });
    const tokenHash = hashToken(parsed.data.token, ctx.cfg.sessionSecret);
    const userId = await ctx.store.consumeEmailVerification(tokenHash);
    if (!userId) return reply.code(400).send({ error: 'invalid_or_expired' });
    await ctx.store.setEmailVerified(userId);
    return reply.send({ ok: true });
  });

  // POST /api/email/resend — re-issue a verification link for the caller's email
  // when it is on file and not yet verified. Auth + persistent + rate-limited.
  app.post('/api/email/resend', async (req, reply) => {
    if (resendLimit(clientIp(req), reply)) return reply;
    if (!ctx.store.persistent) return reply.code(503).send({ error: 'accounts_disabled' });
    const identity = await ctx.identity.resolveToken(readToken(req));
    if (!identity || identity.isGuest) return reply.code(401).send({ error: 'not_authenticated' });
    const user = await ctx.store.getUserById(identity.id);
    if (!user || !user.email) return reply.send({ ok: true });
    if (user.emailVerified) return reply.send({ ok: true, alreadyVerified: true });
    await issueEmailVerification(ctx, user.id, user.email);
    return reply.send({ ok: true });
  });
}

/**
 * Issue + email a verification token for a user. Shared by register (auth
 * routes) and resend. Best-effort: the email send never blocks the caller.
 */
export async function issueEmailVerification(
  ctx: GatewayContext,
  userId: string,
  email: string,
): Promise<void> {
  const token = newSessionToken();
  const tokenHash = hashToken(token, ctx.cfg.sessionSecret);
  await ctx.store.createEmailVerification(userId, tokenHash, Date.now() + VERIFY_TTL_MS);
  void ctx.email.sendVerification(email, token);
}
