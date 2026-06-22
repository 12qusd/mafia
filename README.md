# Project NOCTURNE (working codename)

A standalone online social-deduction game in the Mafia/Werewolf genre, mechanically descended
from the StarCraft II Arcade map **SC2Mafia** (the ancestor of Town of Salem). Web-first,
with a later Electron + Steam desktop release.

This repository contains both the **planning artifacts** (a complete research dossier and the
implementation-ready build specification) and a working TypeScript **pnpm monorepo** implementing
the MVP: shared protocol/data, a pure deterministic rules engine, an authoritative game server, a
React web client, and a bot/sim/leak-detector harness. See [Status](#status) and
[Development](#development).

## Contents

| Path | What it is |
|---|---|
| [`BUILD_SPEC.md`](BUILD_SPEC.md) | **The build specification** — self-contained spec an implementing agent can build the MVP from: architecture, security invariant, full rules engine (15 roles, deterministic night-resolution pipeline), protocol catalog, Postgres schema, testing requirements, milestones M0–M5. |
| [`research/01-game-design.md`](research/01-game-design.md) | How SC2Mafia actually works: core loop, host setup system, ~60-role catalog, chat mechanics, win conditions, the developer-published night-resolution order, recommended MVP role set. |
| [`research/02-engine-stack.md`](research/02-engine-stack.md) | Engine/stack evaluation (Electron+web 9/10, Godot 8/10, Unity 6/10, Tauri disqualified) with Steam-integration maturity per option. |
| [`research/03-networking.md`](research/03-networking.md) | Backend architecture: why server-authoritative is non-negotiable for hidden-information games, transport/framework verdicts, persistence, hosting costs, reconnection, moderation. |
| [`research/04-steam-shipping-legal.md`](research/04-steam-shipping-legal.md) | Steam shipping steps end-to-end, relevant Steamworks features, macOS notarization, and the legal analysis (mechanics are unprotectable; what must be original). |
| [`research/05-comparable-games.md`](research/05-comparable-games.md) | Post-mortems of 11 comparable games (Town of Salem 1/2, Among Us, Throne of Lies, Feign, Goose Goose Duck, Project Winter, Blood on the Clocktower, EpicMafia, Mafia.gg, IRC werewolf) with cross-cutting monetization patterns, pitfalls, success factors. |
| [`research/06-critique.md`](research/06-critique.md) | Adversarial review of the whole plan: top risks (population cold-start, solo playtesting, resolution-engine trust, takedown asymmetry), missing considerations, and pushback on the dossier's own recommendations. **Read this one.** |
| [`research/raw/dossier.json`](research/raw/dossier.json) | The raw structured research output the markdown was generated from. |
| [`scripts/dossier-to-md.mjs`](scripts/dossier-to-md.mjs) | Converter that produced the research markdown from the raw dossier. |

## The plan in one paragraph

TypeScript end-to-end: a React web client (later wrapped in Electron + steamworks.js for Steam)
talking WebSockets to an authoritative Node game server with Postgres behind it. The server
never sends a client a byte its seat isn't entitled to — secrets travel only in per-client
messages, enforced by a CI leak-detector that audits captured traffic from simulated games. The
game engine is a pure deterministic library (seeded PRNG, event-sourced matches) so one person
can test a 15-player game with bot clients. Launch free in the browser first to build a
population; ship the Steam SKU only once nightly lobbies fill. Everything expressive (name, art,
text) must be original; the mechanics lineage is legally safe.

## Key decisions already made

- **MVP scope:** 15 roles (Sheriff, Investigator, Lookout, Doctor, Escort, Jailor, Vigilante,
  Mayor, Citizen / Godfather, Mafioso, Consort, Framer / Serial Killer, Jester, plus
  Executioner & Survivor as flex), one day type (majority + trial), 3 curated setups,
  7–15 player auto-scaling lobbies. **The roster has since expanded to 50 roles** (batches A–F
  plus the Triad, Vampire, and Cult factions; Witch and Transporter/"Bus Driver" are now in) —
  see `DECISIONS.md` and `docs/ADDING_ROLES.md`. The host setup editor remains deferred.
- **Sequencing:** browser launch → community seeding → Steam Playtest/Next Fest → Steam release.
  Windows + web before macOS.
- **Naming:** "NOCTURNE" is a placeholder. The shipping title needs a trademark sweep — no
  "SC2"/"StarCraft", and not a bare "Mafia" (Take-Two marks). This repo's name is incidental.

## Status

Research and specification are done; the MVP is implemented through M3 with M4 partially in
place and deployed.

- [x] Research dossier (5-agent deep research + adversarial critique, June 2026)
- [x] Build specification v1.0
- [x] **M0** — monorepo scaffold (`shared` / `engine` / `server` / `client` / `bots`), strict TS,
  ESLint/Prettier, Vitest workspace.
- [x] **M1** — pure deterministic rules engine (15 roles, §6.8 night-resolution pipeline, win
  checks) with golden + property tests; authoritative server (lobbies, rooms, the §5
  entitlement-routing transport, game loop, auth/identity, persistence layer).
- [x] **M2** — React web client (lobby browser, lobby, full game UI, settings; SNTP-style clock
  sync; plain-text sanitization).
- [x] **M3** — bots + simulator + CI leak-detector: real-protocol socket bots, a FAST engine
  simulator for bulk sweeps, the §5/§12.3 leak auditor, fuzz/abuse tests, `dev:solo`.
- [~] **M4** (partial) — accounts (argon2id) + sessions, Postgres persistence + migrations,
  moderation (reports/sanctions/profanity), a minimal admin page, and telemetry rollups are
  implemented; the server is deployed behind a Cloudflare tunnel.
- [ ] **M5** — Electron + Steam packaging (deferred).

Test suite: run `pnpm -r test` for the full suite across all five packages (shared / engine /
client / server / bots). The exact per-package counts grow as roles and features land, so they're
deliberately not hand-listed here.

## Development

**Prerequisites:** Node 20+ and pnpm 9 (`packageManager` pins `pnpm@9.15.9`).

```sh
pnpm install            # install all workspace deps
pnpm -r build           # build every package (shared → engine → server → client → bots)
pnpm -r test            # run the full test suite
pnpm -r lint            # lint (root: `pnpm lint` = eslint .)
```

### Simulations & solo play

```sh
pnpm sim                # run bot-vs-bot simulations (FAST engine path)
pnpm leakcheck          # full §12.3 leak sweep (≥200 games)
pnpm dev:solo           # boot the server with bots; join via the printed /join/<CODE> link
```

### Running the server

The server serves the built client (SPA) and the WebSocket gateway on a single port.

```sh
pnpm --filter @nocturne/client build           # produce packages/client/dist (served statically)
NO_DB=1 PORT=8080 pnpm --filter @nocturne/server start
```

Server environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WS port (production sits behind a Cloudflare tunnel → localhost:8080). |
| `HOST` | `0.0.0.0` | Bind host. |
| `NO_DB` | `false` | `1` runs guests-only, in-memory, no Postgres (dev / CI / bots). |
| `DATABASE_URL` | — | Postgres connection string (used when `NO_DB` is unset). |
| `SESSION_SECRET` | dev placeholder | Secret used to derive session-token hashes — **set in production**. |
| `SESSION_TTL_MS` | 30 days | Session lifetime in milliseconds. |
| `SERVER_BUILD` | `dev` | Server build identifier persisted with matches. |
| `DRAIN_MAX_MS` | 1 hour | Max time a draining server lets running games finish (§4.4, §13.4). |
| `ADMIN_TOKEN` | — | Bootstrap token for the admin endpoints (`x-admin-token` header). |
| `CLIENT_DIST_DIR` | `../client/dist` | Directory of the built client to serve statically (§4.2). |
| `NOCTURNE_TEST_MODE` | `false` | `1` lets **any** caller create a `testMode` lobby (god-view + Director UI + audit endpoint). See [Test mode & smoke checks](#test-mode--smoke-checks) and the **SECURITY** note below. |
| `LLM_BASE_URL` | — | OpenAI-compatible base URL for TEST-MODE LLM bots; unset ⇒ LLM bots disabled. |
| `LLM_MODEL` | `llama3.2` | Model name passed to the LLM endpoint. |
| `LLM_API_KEY` | — | API key for the LLM endpoint (omit for a local/unauthenticated model). |
| `LLM_MAX_CONCURRENCY` | `2` | Max concurrent in-flight LLM bot requests. |
| `LLM_TIMEOUT_MS` | `8000` | Per-request LLM timeout in milliseconds. |

All of the above are read by [`packages/server/src/config.ts`](packages/server/src/config.ts); the
live pm2 deployment sets them in [`ecosystem.config.cjs`](ecosystem.config.cjs).

### Test mode & smoke checks

`NOCTURNE_TEST_MODE=1` opens a **test-mode gate** on the server. When the gate is open, any caller
(not just admins) can create a lobby with `config.testMode=true`; the lobby is forced `private` and
TEST-badged, and its host becomes the "god" audience. A test-mode game grants the host:

- **god-view** — full `debug_state` / `debug_trace` snapshots of every seat's hidden role and the
  night-resolution pipeline (normally never sent to any client; §5).
- the **Director UI** — `test_control` messages (add/remove bots, `end_phase`, etc.) driven from the
  client's `DirectorPanel`.
- `GET /api/test/match/:roomId/audit` — a downloadable full-match audit JSON (setup, seed, action
  log, all resolution traces, per-seat private-result history). Gated to the test lobby's host or an
  admin (`x-admin-token`); non-test/unknown rooms always 404.

Two real smoke scripts exercise this path end to end (see [`scripts/`](scripts/)):

```sh
node scripts/smoke-test-mode.mjs   # boots the real server with NOCTURNE_TEST_MODE=1 NO_DB=1, runs a
                                   # full 7-player bot game, asserts debug_trace + the audit endpoint
                                   # (also: pnpm smoke:test-mode)
node scripts/smoke-llm-bots.mjs    # against an already-running server (defaults to the live :8080
                                   # pm2 deploy with LLM_BASE_URL set): backfills LLM bots into a
                                   # test lobby and confirms they produce legal moves end to end
```

> **⚠️ SECURITY — known, accepted exposure (as of 2026-06-14).**
> The live pm2 deploy ([`ecosystem.config.cjs`](ecosystem.config.cjs)) currently sets
> `NOCTURNE_TEST_MODE=1` in production. With the gate open, the admin check in
> `packages/server/src/lobby/manager.ts` (`testModeEnv === true || conn.identity?.isAdmin`) passes
> for **anyone** — so any visitor to the public site can create a `testMode` lobby and obtain
> god-view, the Director (`test_control`) controls, and the `/api/test/match/:id/audit` endpoint
> for their own match. The lobby is forced private, but the creator still sees all hidden roles and
> resolution traces in a game they control. This is a **deliberate, operator-accepted exposure for
> now** (kept on to support live testing); it is **not** an inadvertent leak of other players'
> public games. To close it, drop `NOCTURNE_TEST_MODE` from the production env and rebuild/restart.
> See also [`OPERATIONS.md`](OPERATIONS.md).

### Postgres (full-persistence mode)

```sh
docker compose -f packages/server/docker-compose.yml up -d   # local Postgres (host port 5433)
pnpm --filter @nocturne/server migrate                       # apply schema.sql idempotently
DATABASE_URL=postgres://… pnpm --filter @nocturne/server start
```

### Client dev server

```sh
pnpm --filter @nocturne/client dev   # Vite dev server; proxies /api + /ws to the game server
```
