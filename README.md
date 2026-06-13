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
  7–15 player auto-scaling lobbies. Witch / Bus Driver / Cult / Triad / the host setup editor
  are deliberately deferred.
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

Test suite: 122 (shared) + 47 (engine) + 47 (client) + 36 (server) + 18 (bots).

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
| `ADMIN_TOKEN` | — | Bootstrap token for the admin endpoints (`x-admin-token` header). |

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
