# Operations — Project NOCTURNE live deploy

Operational notes for the live homelab deployment (public site behind a Cloudflare tunnel). All
claims here were verified against the repo and the running host on **2026-06-14**. Source of truth
for the env is [`ecosystem.config.cjs`](ecosystem.config.cjs); the config reader is
[`packages/server/src/config.ts`](packages/server/src/config.ts).

## ⚠️ SECURITY — `NOCTURNE_TEST_MODE=1` is live (known, accepted exposure)

The pm2 app sets `NOCTURNE_TEST_MODE=1` in production. With the gate open, the admin check in
`packages/server/src/lobby/manager.ts`
(`const allowed = this.deps.testModeEnv === true || conn.identity?.isAdmin === true;`) passes for
**any** caller. So any visitor can create a `testMode` lobby and receive, for their own match:

- **god-view** — full `debug_state` / `debug_trace` snapshots (every seat's hidden role + the full
  night-resolution pipeline), which §5 otherwise forbids sending to any client;
- the **Director** controls — `test_control` messages (add/remove bots, `end_phase`, …);
- `GET /api/test/match/:roomId/audit` — the full-match audit JSON (setup, seed, action log,
  resolution traces, per-seat private-result history).

The lobby is forced `private` and TEST-badged, and the audit endpoint is gated to that lobby's host
or an admin — so this is **not** a leak of other players' normal public games. It is the host
seeing hidden information in a game they themselves created. This is a **deliberate,
operator-accepted exposure as of 2026-06-14**, kept on to support live testing (e.g.
`scripts/smoke-llm-bots.mjs` runs against the live :8080 deploy).

**To close it:** remove `NOCTURNE_TEST_MODE` from `ecosystem.config.cjs`, then
`pnpm -r build && pm2 restart nocturne` (or `pm2 reload nocturne`). After that the gate is closed
and only admins can create test lobbies.

## Process map (pm2)

`pm2 list` on the host shows three online processes:

| pm2 name | exec path | role |
|---|---|---|
| `nocturne` | `packages/server/dist/start.js` | the game server (HTTP + WS) on `:8080` |
| `cloudflared-tunnel` | `~/.local/bin/cloudflared tunnel run --token …` | Cloudflare tunnel exposing `:8080` to the public hostname |
| `llm-mafia` | `~/llm/llama-b9616/llama-server` | local OpenAI-compatible model (`LLM_BASE_URL=http://127.0.0.1:11435/v1`) backing TEST-MODE LLM bots |

## Entrypoint: `start.js`, not `index.js`

Production boots **`packages/server/dist/start.js`** (per `ecosystem.config.cjs`), **not**
`dist/index.js`.

- `start.ts` calls `main()` **unconditionally** — required under pm2, whose fork-mode wrapper makes
  `process.argv[1]` point at the wrapper rather than the entry module.
- `index.ts` only boots when invoked **directly** (`process.argv[1]` ends with `index.js`) so tests
  can `import { buildApp }` without starting a server. Under pm2 that direct-invocation guard would
  be false, so `index.js` would import cleanly and then **exit without ever listening** — which is
  exactly why the deploy uses `start.js`.

The local `pnpm --filter @nocturne/server start` script still runs `node dist/index.js` (fine when
launched directly from a shell); only the pm2 deploy needs `start.js`.

## No reboot persistence (pm2 not wired to systemd)

There is **no `pm2-fox.service`** systemd unit (`systemctl status pm2-fox` → "could not be found"),
and pm2's own `pm2 startup` still prints the "copy/paste the following command" hint — i.e. the
startup hook has not been installed. **The pm2 process set does not come back after a host reboot.**

A saved process dump exists (`~/.pm2/dump.pm2`), so after a reboot the stack can be brought back
manually with `pm2 resurrect` — but nothing does this automatically. To make it survive reboots,
run the `sudo env PATH=… pm2 startup systemd -u fox --hp /home/fox` command pm2 prints, then
`pm2 save`.

## The site 404s during `pnpm -r build`

The server serves the client from `CLIENT_DIST_DIR`
(`/home/fox/Projects/mafia/packages/client/dist`) with `@fastify/static` registered `wildcard: true`
(see `packages/server/src/app.ts`), meaning it reads files **per request, live from disk** — a
client rebuild's new hashed asset names are picked up without restarting the server.

The flip side: `pnpm -r build` rebuilds the client into that **same** directory the live process is
reading from, and Vite empties/repopulates `dist` during the build. While a build is in flight,
requests can hit a moment where `index.html` or a hashed asset is briefly absent, so the public site
can **404 / serve partial assets mid-build**. Non-`/api`/`/ws`/`/admin`/`/healthz` paths fall back
to `index.html`, so the failure mode is mostly a missing/blank page or a missing asset until the
build finishes — not a hard outage of the API/WS gateway. For a clean swap, build into a staging
directory and repoint `CLIENT_DIST_DIR` (or accept the brief window during low-traffic deploys).
