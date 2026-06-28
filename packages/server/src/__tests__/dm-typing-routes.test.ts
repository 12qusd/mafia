/**
 * DM typing-indicator route checks (deferred-tail wave). Ephemeral, in-memory,
 * account-only typing state — no DB, lost on restart.
 *
 * The happy path needs a persistent (account) store, which NO_DB lacks, so we
 * reuse the social-routes test pattern: (a) make the MemoryStore present as
 * persistent so `requireAccount` does not short-circuit to 503, and (b) stub
 * `resolveToken` so a Bearer token maps to a fixed account identity. Every store
 * method called downstream (ensureDmThread) is implemented by the MemoryStore.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { buildTestContext } from './helpers.js';
import { registerSocialRoutes } from '../http/social-routes.js';

// Two synthetic accounts (valid uuids — the DM routes UUID-guard the param).
const ALICE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alice',
  isGuest: false,
  isAdmin: false,
} as const;
const BOB = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Bob',
  isGuest: false,
  isAdmin: false,
} as const;
const CARL = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Carl',
  isGuest: false,
  isAdmin: false,
} as const;

type Account = typeof ALICE;

function makePersistent(ctx: { store: { persistent: boolean } }): void {
  Object.defineProperty(ctx.store, 'persistent', { value: true, configurable: true });
}

function stubIdentity(
  ctx: { identity: { resolveToken: (t: string | undefined) => Promise<unknown> } },
  byToken: Record<string, Account>,
): void {
  ctx.identity.resolveToken = async (token: string | undefined) =>
    (token && byToken[token]) || null;
}

async function buildApp() {
  const { ctx, store } = buildTestContext();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerSocialRoutes(app, ctx);
  await app.ready();
  return { app, ctx, store };
}

describe('DM typing — gate (NO_DB / guests / anon)', () => {
  it('a guest gets 403 on POST typing (account-only)', async () => {
    const { app, ctx } = await buildApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('an unauthenticated caller gets 401 on POST typing', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/dms/${BOB.id}/typing` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('a guest gets 403 on GET typing', async () => {
    const { app, ctx } = await buildApp();
    const guest = ctx.identity.createGuest();
    const res = await app.inject({
      method: 'GET',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: `Bearer ${guest.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('a non-persistent (NO_DB) account store yields 503 (accounts_disabled)', async () => {
    const { app, ctx } = await buildApp();
    // Do NOT make persistent: stub an account identity, requireAccount → 503.
    stubIdentity(ctx, { 'tok-alice': ALICE });
    const res = await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('DM typing — stamp + read window', () => {
  it('stamping then reading within the window → typing:true', async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE, 'tok-bob': BOB });

    // Alice stamps herself as typing in her thread with Bob.
    const stamp = await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    expect(stamp.statusCode).toBe(200);
    expect((stamp.json() as { ok: boolean }).ok).toBe(true);

    // Bob, polling the same thread, sees Alice typing.
    const read = await app.inject({
      method: 'GET',
      url: `/api/dms/${ALICE.id}/typing`,
      headers: { authorization: 'Bearer tok-bob' },
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { typing: boolean }).typing).toBe(true);
  });

  it('the typist does NOT see their own stamp as the other party typing', async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE });

    await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    // Alice polling her own thread: only her own (excluded) stamp is live.
    const read = await app.inject({
      method: 'GET',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    expect((read.json() as { typing: boolean }).typing).toBe(false);
    await app.close();
  });

  it('the fold: GET /api/dms surfaces otherTyping for the other party', async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE, 'tok-bob': BOB });

    await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/dms/${ALICE.id}`,
      headers: { authorization: 'Bearer tok-bob' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { otherTyping: boolean }).otherTyping).toBe(true);
    await app.close();
  });

  it('after the TTL window elapses, typing reads false', async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE, 'tok-bob': BOB });

    const NOW = 1_000_000;
    const realNow = Date.now;
    try {
      Date.now = () => NOW;
      await app.inject({
        method: 'POST',
        url: `/api/dms/${BOB.id}/typing`,
        headers: { authorization: 'Bearer tok-alice' },
      });
      // Jump past the 5s TTL: the stamp is now dead.
      Date.now = () => NOW + 6_000;
      const read = await app.inject({
        method: 'GET',
        url: `/api/dms/${ALICE.id}/typing`,
        headers: { authorization: 'Bearer tok-bob' },
      });
      expect((read.json() as { typing: boolean }).typing).toBe(false);
    } finally {
      Date.now = realNow;
    }
    await app.close();
  });
});

describe('DM typing — participant isolation', () => {
  it("a non-participant cannot read another pair's typing", async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE, 'tok-bob': BOB, 'tok-carl': CARL });

    // Alice types at Bob.
    await app.inject({
      method: 'POST',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });

    // Carl polling HIS thread with Alice resolves a DIFFERENT thread id, so he
    // never sees the Alice↔Bob typing stamp.
    const carlReadsAlice = await app.inject({
      method: 'GET',
      url: `/api/dms/${ALICE.id}/typing`,
      headers: { authorization: 'Bearer tok-carl' },
    });
    expect((carlReadsAlice.json() as { typing: boolean }).typing).toBe(false);

    // And Carl polling his thread with Bob likewise sees nothing.
    const carlReadsBob = await app.inject({
      method: 'GET',
      url: `/api/dms/${BOB.id}/typing`,
      headers: { authorization: 'Bearer tok-carl' },
    });
    expect((carlReadsBob.json() as { typing: boolean }).typing).toBe(false);
    await app.close();
  });

  it('rejects a non-uuid id (404) and self (400)', async () => {
    const { app, ctx } = await buildApp();
    makePersistent(ctx);
    stubIdentity(ctx, { 'tok-alice': ALICE });

    const badId = await app.inject({
      method: 'POST',
      url: '/api/dms/not-a-uuid/typing',
      headers: { authorization: 'Bearer tok-alice' },
    });
    expect(badId.statusCode).toBe(404);

    const self = await app.inject({
      method: 'POST',
      url: `/api/dms/${ALICE.id}/typing`,
      headers: { authorization: 'Bearer tok-alice' },
    });
    expect(self.statusCode).toBe(400);
    await app.close();
  });
});
