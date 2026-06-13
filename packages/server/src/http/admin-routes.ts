/**
 * Admin HTTP routes + ultra-simple admin HTML page (BUILD_SPEC §11.3, §15).
 *
 * Guarded by either the admin flag on the authenticated user, or an
 * `x-admin-token` header matching ADMIN_TOKEN (bootstrap for solo ops). Every
 * admin action is logged (§11.3). The page at `/admin` lists open reports and
 * lets an admin apply a sanction; `/admin/stats` returns telemetry JSON (§15).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { GatewayContext } from '../ws/context.js';
import { readToken } from './auth-routes.js';
import { escapeHtml } from './html.js';

const SanctionBody = z.object({
  userId: z.string().min(1),
  type: z.enum(['warning', 'mute', 'temp_ban', 'perma_ban']),
  reason: z.string().max(500).optional(),
  reportId: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
});

async function requireAdmin(
  ctx: GatewayContext,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ adminId: string } | null> {
  const headerToken = req.headers['x-admin-token'];
  if (ctx.cfg.adminToken && headerToken === ctx.cfg.adminToken) {
    return { adminId: 'admin-token' };
  }
  const identity = await ctx.identity.resolveToken(readToken(req));
  if (identity?.isAdmin) return { adminId: identity.id };
  reply.code(403).send({ error: 'forbidden' });
  return null;
}

export function registerAdminRoutes(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/admin/stats', async (req, reply) => {
    const admin = await requireAdmin(ctx, req, reply);
    if (!admin) return;
    return reply.send(ctx.telemetry.snapshot());
  });

  app.get('/admin/reports', async (req, reply) => {
    const admin = await requireAdmin(ctx, req, reply);
    if (!admin) return;
    const reports = await ctx.moderation.listReports('open');
    return reply.send(reports);
  });

  app.post('/admin/sanction', async (req, reply) => {
    const admin = await requireAdmin(ctx, req, reply);
    if (!admin) return;
    const parsed = SanctionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    await ctx.moderation.applySanction({
      userId: parsed.data.userId,
      type: parsed.data.type,
      reason: parsed.data.reason ?? null,
      reportId: parsed.data.reportId ?? null,
      issuedBy: admin.adminId,
      ...(parsed.data.durationMs ? { durationMs: parsed.data.durationMs } : {}),
    });
    return reply.send({ ok: true });
  });

  // Minimal admin HTML page (§11.3). Plain, no framework.
  app.get('/admin', async (req, reply) => {
    const admin = await requireAdmin(ctx, req, reply);
    if (!admin) return;
    const reports = await ctx.moderation.listReports('open');
    const stats = ctx.telemetry.snapshot();
    const rows = reports
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.targetUser)}</td>
          <td>${escapeHtml(r.category)}</td>
          <td>${escapeHtml(r.comment ?? '')}</td>
          <td><pre>${escapeHtml(JSON.stringify(r.evidence ?? {}, null, 0)).slice(0, 400)}</pre></td>
          <td>
            <form method="post" action="/admin/sanction-form">
              <input type="hidden" name="userId" value="${escapeHtml(r.targetUser)}"/>
              <input type="hidden" name="reportId" value="${escapeHtml(r.id)}"/>
              <select name="type">
                <option value="warning">warning</option>
                <option value="mute">mute</option>
                <option value="temp_ban">temp_ban</option>
                <option value="perma_ban">perma_ban</option>
              </select>
              <input name="reason" placeholder="reason"/>
              <button type="submit">apply</button>
            </form>
          </td>
        </tr>`,
      )
      .join('');
    const statRows = Object.entries(stats)
      .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`)
      .join('');
    reply.type('text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Nocturne Admin</title>
<style>body{font-family:system-ui;margin:2rem;background:#16131a;color:#e8e1ef}
table{border-collapse:collapse;width:100%;margin-bottom:2rem}
td,th{border:1px solid #443a52;padding:.4rem;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;margin:0;font-size:.75rem}
button{cursor:pointer}</style></head>
<body><h1>Nocturne Admin</h1>
<h2>Telemetry</h2><table>${statRows}</table>
<h2>Open reports (${reports.length})</h2>
<table><tr><th>target</th><th>category</th><th>comment</th><th>evidence</th><th>action</th></tr>${rows}</table>
</body></html>`);
  });

  // Form-encoded sanction submission from the admin page.
  app.post('/admin/sanction-form', async (req, reply) => {
    const admin = await requireAdmin(ctx, req, reply);
    if (!admin) return;
    const body = (req.body ?? {}) as Record<string, string>;
    const parsed = SanctionBody.safeParse({
      userId: body.userId,
      type: body.type,
      reason: body.reason || undefined,
      reportId: body.reportId || undefined,
    });
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    await ctx.moderation.applySanction({
      userId: parsed.data.userId,
      type: parsed.data.type,
      reason: parsed.data.reason ?? null,
      reportId: parsed.data.reportId ?? null,
      issuedBy: admin.adminId,
    });
    return reply.redirect('/admin');
  });
}
