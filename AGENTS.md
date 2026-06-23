# AGENTS.md — Project NOCTURNE (repo: `mafia`)

> Operating constitution for any agent or human working in this repo. Read this
> first, then the doc index at the bottom. Source of truth is the code; this file
> orients you to it. Verified against the repo 2026-06-21.

## What this is

An online social-deduction game in the Mafia/Werewolf genre, mechanically
descended from the SC2 II Arcade map **SC2Mafia** (ancestor of Town of Salem).
Web-first (React client over WebSocket to an authoritative Node server with
Postgres); a later Electron + Steam desktop SKU is scaffolded but not built
(`apps/desktop`). Working codename **NOCTURNE**; the shipping title needs a
trademark sweep (no "SC2"/"StarCraft", no bare "Mafia" — Take-Two marks).

**Repo facts**

- GitHub: `12qusd/mafia`. Live checkout on host `mrfox` at
  `/home/fox/Projects/mafia` (Debian, accessed via `ssh mrfox`).
- Active branch: `feat/nocturne-full-buildout` (well ahead of `main` — ~24
  commits and counting). `main` is the default branch but lags the buildout.
- Stack: TypeScript end-to-end. Node 20+ (`.nvmrc` = `20`),
  `pnpm@9.15.9` (`packageManager`). Strict TS, ESLint (typescript-eslint),
  Prettier, Vitest. ESM (`"type": "module"`), `module: NodeNext`.
- Monorepo: `packages/{shared,engine,server,client,bots}` + `apps/desktop`
  (placeholder). Workspace globs in `pnpm-workspace.yaml`.
- 50 roles shipped (MVP was 15; expanded through batches A–F + Triad/Vampire/Cult).
- Status: M0–M3 done, M4 partial (accounts, Postgres, moderation, admin,
  telemetry — deployed behind a Cloudflare tunnel), M5 (Electron/Steam) deferred.

## The prime invariant (read this before touching anything)

**BUILD_SPEC §5: the server never sends a client a byte its seat isn't entitled
to.** Secrets travel only in per-client messages. This is the one rule that, if
broken, leaks hidden roles and ruins the game.

Enforcement, all load-bearing:

- `packages/server/src/transport.ts` is the **only** module allowed to call
  `socket.send`. `ScopedTransport.dispatchEffect(effect)` reads the audience
  (`'public' | 'dead' | 'mafia' | 'triad' | SeatId[]`) from the engine `Effect`
  and routes to the right sockets — membership comes from engine state, never
  from the message body. Spectators receive only `'public'` frames.
- ESLint `no-restricted-syntax` forbids `.send(` member calls in every source
  file except `transport.ts` (see `eslint.config.js`). Do not weaken this.
- The **leak detector** (`packages/bots/src/leak.ts` + the `§12.3` suite in
  `packages/bots/src/__tests__/leak.test.ts`) runs ≥200 seeded games over the
  real protocol and asserts nothing secret reaches an unentitled seat. A new
  role/result/frame that carries a secret MUST update the allowlist in `leak.ts`
  or the suite fails. Run `pnpm leakcheck` before claiming a role is done.
- `debug_state` / `debug_trace` frames (full hidden roles + resolution pipeline)
  are sent **only** to a test-mode lobby's host audience, never in normal play.
  See TEST MODE below.

If you add any outbound message path that bypasses `transport.ts`, or address a
secret to the wrong audience, you have broken the invariant. Stop and fix it.

## Architecture map

Build order matters — later packages import earlier ones:
`shared → engine → server → client → bots` (`pnpm -r build` respects this).

| Package | Exports | Role |
|---|---|---|
| `@nocturne/shared` | types, zod schemas, role data, setups, strings | Protocol/data contract, role definitions, setups. **No game logic.** Zod-validated wire schemas (`protocol/`). Roles are data in `roles/*.ts`; the engine reads them. |
| `@nocturne/engine` | `init`, `apply`, `nextDeadline`, `debugView`, `hashState`, PRNG | Pure deterministic rules engine. No I/O, no `Date.now`, no `Math.random` — one seeded PRNG in `GameState`. Same `(setup, seed, event log)` ⇒ byte-identical state. |
| `@nocturne/server` | `buildApp`, `main`, `start` | Authoritative game server (Fastify HTTP + `ws` WebSocket on one port). Lobbies, rooms, game loop, auth/identity, persistence, moderation, the §5 transport, TEST MODE. |
| `@nocturne/client` | Vite SPA | React 18 + zustand + react-router. Lobby browser, lobby, full game UI, settings, leaderboard, replays, admin, Director (test mode). Three.js stage (`@react-three/fiber`). |
| `@nocturne/bots` | `runtime`, CLI bins | Real-protocol socket bots, a FAST engine simulator for bulk sweeps, the leak auditor, fuzz/abuse tests, `dev:solo`. |

Key source files to know:

- `packages/engine/src/resolve.ts` — the **9-step night-resolution pipeline**
  (§6.8). Order is load-bearing: jail → roleblocks → protection → deception →
  kills → investigations → deaths → promotions → win. Every meaningful outcome
  pushes a `ResolutionTrace` record (the audit trail + golden-test fixture +
  god-view `debug_trace`).
- `packages/engine/src/apply.ts` — the pure `apply(state, event) → {state,
  effects}` reducer; also `runNightResolution`, `startDayVoting`,
  `afterExecution`, `handleChat`.
- `packages/engine/src/wincheck.ts` — win conditions generalized to four evil
  factions (Mafia, Triad, Vampire, Cult) + neutrals.
- `packages/engine/src/state.ts` — `GameState` is plain JSON-serializable data
  (no classes/closures/Maps/Sets) so it can be hashed, diffed, persisted,
  replayed. Treated immutably.
- `packages/server/src/config.ts` — every env read, typed. The single source for
  server config.
- `packages/server/src/lobby/manager.ts` — lobby lifecycle, TEST MODE gate
  (`testModeEnv === true || conn.identity?.isAdmin`).
- `packages/server/src/room/room.ts` — a running game: engine adapter, god-view
  emission, phase timers.
- `packages/server/src/transport.ts` — the §5 invariant (see above).
- `packages/client/src/store/reducer.ts` — pure `reduce` over `ServerMessage`
  frames; the client's whole game state is derived here.
- `packages/bots/src/leak.ts` — the leak auditor allowlist/role set.

## Commands

Run from the repo root unless noted. All packages: `pnpm -r <cmd>`.

```sh
pnpm install                 # install workspace deps
pnpm -r build                # build all (shared → engine → server → client → bots)
pnpm -r test                 # full Vitest suite (shared/engine/client/server/bots)
pnpm test                    # same, via root vitest.workspace.ts
pnpm lint                    # eslint .  (also: pnpm -r lint for per-package)
pnpm lint --fix              # autofix
pnpm format                  # prettier --write .
pnpm format:check            # prettier --check .
pnpm typecheck               # tsc --noEmit across packages (pnpm -r typecheck)
pnpm sim                     # bot-vs-bot simulations (FAST engine path)
pnpm leakcheck               # full §12.3 leak sweep (≥200 games)
pnpm dev:solo                # boot server + bots; join via printed /join/<CODE>
pnpm smoke:test-mode         # scripts/smoke-test-mode.mjs (real server, TEST MODE)
```

Per-package: `pnpm --filter @nocturne/<pkg> <cmd>` (e.g.
`pnpm --filter @nocturne/client dev` for the Vite dev server).

**Gate before shipping a role or engine change:**
`pnpm -r build && pnpm -r test && npx eslint .` must be green, plus a leak sweep
(`pnpm leakcheck`) at 0 leaks for any touched setup.

## Engine model (don't break determinism)

- `init(setup, seed) → GameState`; `apply(state, event) → {state, effects}`;
  `nextDeadline(state)`. Pure. Clone, never mutate. PRNG only via the seeded
  `seedPrng`/`nextFloat`/`nextInt` carried in state.
- `apply` returns a **new** state and a list of `Effect`s (each carries `to`
  audience + `ServerMessage`). The server's transport dispatches effects; the
  engine never touches a socket.
- The 9-step pipeline in `resolve.ts` is order-sensitive. Hook a new ability
  into the correct step (see `docs/ADDING_ROLES.md` §4). Push a
  `ResolutionTrace` for every meaningful outcome.
- Win logic fires from `apply.ts` (`runNightResolution`, `startDayVoting`,
  `afterExecution`) into `wincheck.ts`.
- Tests: golden night tests (`packages/engine/test/night.test.ts`), win/day
  tests, purity/property tests (`fast-check`). The harness
  (`packages/engine/test/harness.ts`) builds exact seat→role mini-games.

## Protocol & entitlement

- Wire schemas are zod-defined in `packages/shared/src/protocol/`
  (`client.ts`, `server.ts`, `common.ts`, `objects.ts`, `private_result.ts`,
  `debug.ts`, `enums.ts`, `errors.ts`). The server validates outbound frames
  against `ServerMessageSchema` in non-production (defense in depth, `transport.ts`).
- The client validates inbound frames with `safeParseServerMessage` and reduces
  them through the pure `store/reducer.ts`. No game logic in the client.
- Adding a new message type: add the schema in `shared/protocol/`, handle it in
  the server, reduce it in the client. Secret-bearing frames must be addressed
  to the entitled seat only — then prove it with the leak auditor.

## Roles & setups

- A role is **data** in `packages/shared/src/roles/<role>.ts`
  (`RoleDefinition`). The engine reads it; the client role card is generated
  from shared data — you usually do **not** touch the client. Full end-to-end
  checklist: **`docs/ADDING_ROLES.md`** (read it before adding a role).
- Register a new role: add to `ROLE_IDS` (`types/role.ts`), import + add to
  `ROLES` + the export block (`roles/index.ts`), update
  `INVESTIGATOR_CLASS_TABLE` if it changes investigation reads, add a setup slot
  (`setups/`), map any night ability in `engine/src/roleinfo.ts`, hook the
  resolution step in `engine/src/resolve.ts`, update `wincheck.ts` if it affects
  parity/win, add golden tests, and update the leak auditor allowlist
  (`bots/src/leak.ts`).
- Setups (`packages/shared/src/setups/`): `classic.ts`, `curated.ts`, `daily`,
  `chaos`, plus `compose.ts`/`validate.ts`. `validateSetup` enforces structural
  validity (slots, uniques, killing-role-present); setup tests assert it.
- Current role count: **50**. Factions: Town, Mafia, Triad, Vampire, Cult,
  Neutral (benign/killing/evil). Four evil killing factions feed `wincheck.ts`.

## TEST MODE (god view + Director + audit)

`NOCTURNE_TEST_MODE=1` opens a gate: any caller can create a `testMode` lobby
(forced private, TEST-badged) whose host receives:

- **god-view** — `debug_state`/`debug_trace` (every hidden role + the full
  resolution pipeline), normally never sent to any client (§5).
- the **Director** — `test_control` messages (add/remove bots, `end_phase`,
  `request_state`) from the client `DirectorPanel`.
- `GET /api/test/match/:roomId/audit` — full-match audit JSON (setup, seed,
  action log, all traces, per-seat private results). `:roomId` is the lobby id
  (the server reuses the lobby id as the room id). Host-or-admin only; non-test
  rooms 404.

Use this to validate a new role against the real engine solo
(`docs/ADDING_ROLES.md` §7). Smoke scripts: `scripts/smoke-test-mode.mjs`,
`scripts/smoke-llm-bots.mjs`.

> **⚠️ SECURITY — known, accepted exposure.** The live pm2 deploy
> (`ecosystem.config.cjs`) currently sets `NOCTURNE_TEST_MODE=1` in production,
> so any visitor can create a test lobby and get god-view for their own match
> (not other players' public games). Deliberate, operator-accepted as of
> 2026-06-14. To close: drop `NOCTURNE_TEST_MODE` from the env and
> `pnpm -r build && pm2 restart nocturne`. See `OPERATIONS.md`.

## Deploy & ops (host `mrfox`)

Source of truth: `OPERATIONS.md` and `ecosystem.config.cjs`.

- **pm2** runs three processes: `nocturne` (server on `:8080`),
  `cloudflared-tunnel` (exposes `:8080` to the public hostname), and
  `llm-mafia` (local `llama-server` at `LLM_BASE_URL=http://127.0.0.1:11435/v1`
  backing TEST MODE LLM bots).
- **Entry point under pm2 is `packages/server/dist/start.js`, NOT `dist/index.js`.**
  `start.ts` calls `main()` unconditionally (pm2 fork-mode makes `process.argv[1]`
  point at the wrapper). `index.ts` only boots when invoked directly, so under pm2
  it would import and exit without listening. The local `pnpm start` script runs
  `index.js` — fine from a shell, wrong under pm2.
- **No reboot persistence.** pm2 is not wired to systemd (`pm2 startup` not
  installed). After a host reboot, `pm2 resurrect` from the saved dump brings
  the stack back manually. Nothing does it automatically.
- **The site 404s during `pnpm -r build`.** The server serves the client from
  `CLIENT_DIST_DIR` with `@fastify/static wildcard: true` (reads per request),
  and Vite empties/repopulates `dist` mid-build. API/WS/admin/healthz stay up;
  the SPA can briefly 404. For a clean swap, build into a staging dir and repoint
  `CLIENT_DIST_DIR`.
- Postgres: `docker compose -f packages/server/docker-compose.yml up -d` (host
  port 5433), then `pnpm --filter @nocturne/server migrate`. `NO_DB=1` runs
  guests-only in-memory (dev/CI/bots).
- Env vars: see `packages/server/src/config.ts` and the README table. Live values
  live in `ecosystem.config.cjs` on the host, which holds real secrets
  (`SESSION_SECRET`, `ADMIN_TOKEN`). That file is **gitignored and NOT tracked**
  (`.gitignore` line 33; never committed — verified `git log --all` is empty for
  it), so the secrets are not in the repo or on GitHub. Keep it untracked; don't
  paste the values into external channels; rotate if ever exposed.

## Conventions

- **TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
  + `useUnknownInCatchVariables`.** `verbatimModuleSyntax` → use `import type`
  for types. ESLint enforces `consistent-type-imports` (inline `type` imports).
- **Prettier:** single quotes, trailing commas `all`, 100 cols, 2-space, semis.
  Run `pnpm format`.
- **No `socket.send` outside `transport.ts`** (ESLint-enforced) — the §5 invariant.
- **Engine purity:** no I/O, no `Date.now`, no `Math.random`, no mutation of
  input state. Randomness only via the seeded PRNG in `GameState`.
- **Clean-room (legally binding).** Mechanics derive from the SC2Mafia lineage
  (mechanics aren't protectable); all **expressive** content — role descriptions,
  result strings, announcements, flavor, names, visual identity — is written
  fresh. The only source consulted for expressive content is `BUILD_SPEC.md`
  (see `CLEANROOM.md`). Do not copy text from Town of Salem, SC2Mafia, or any
  other game. Theme: **1920s noir / Prohibition**.
- **Role names** are generic dictionary words only (no coined names from source
  games). No StarCraft/Blizzard assets, names, icons, or fonts.
- **Client strings:** shared copy lives in `@nocturne/shared/strings.ts`; the
  client adds its own in `lib/strings-extra.ts` and does not edit shared strings
  (per `DECISIONS-client.md`).
- **Decision log:** record every non-trivial design choice in `DECISIONS.md`
  (repo-wide) or `DECISIONS-client.md` (client-only). These are the institutional
  memory — read them before reversing a prior decision.
- **Branch:** work on `feat/nocturne-full-buildout` (or a branch off it). Don't
  push to `main` directly; `main` lags. Don't commit secrets.

## Common tasks

- **Add a role:** follow `docs/ADDING_ROLES.md` end-to-end. Gate with
  `pnpm -r build && pnpm -r test && npx eslint .` + a leak sweep.
- **Validate a role solo:** boot `NOCTURNE_TEST_MODE=1 NO_DB=1` server, create a
  test lobby, backfill bots, `end_phase` through nights, read `debug_trace`,
  download the audit JSON. See `docs/ADDING_ROLES.md` §7.
- **Run a leak sweep:** `pnpm leakcheck` (or per-setup inline with `NO_DB=1`).
  Must be 0 leaks. Update `bots/src/leak.ts` allowlist for new secret frames.
- **Deploy:** on `mrfox`, `pnpm -r build && pm2 restart nocturne` (mind the
  brief 404 window during client build). Cloudflare tunnel + Postgres must be up.
- **Add a server env var:** add it to `config.ts` (`loadConfig`), document it in
  the README env table and `OPERATIONS.md`, set it in `ecosystem.config.cjs`.

## Footguns

- Under pm2, boot `start.js` not `index.js` (see Deploy).
- `pnpm -r build` into the live `CLIENT_DIST_DIR` causes brief 404s.
- pm2 does not survive a host reboot (no systemd unit).
- `NOCTURNE_TEST_MODE=1` is live in production (accepted exposure) — see SECURITY.
- The audit `:roomId` is the **lobby id** (not in `game_started`; derived). See
  `DECISIONS-client.md`.
- `debug_trace` is de-duped by `nightNumber` on the client (resends don't double).
- Death is **permanent**: no living↔dead contact. Medium (séance) and
  Retributionist (revive) were removed; the `dead` channel is strictly dead-only.
- `exactOptionalPropertyTypes` is on — `foo?: T` and `foo: T | undefined` are
  not interchangeable. Don't sprinkle `| undefined` to silence the checker.

## Doc index (read these)

| Doc | What |
|---|---|
| `BUILD_SPEC.md` | The self-contained build spec: architecture, §5 invariant, full rules engine, §6.8 pipeline, protocol catalog, Postgres schema, testing, milestones. |
| `DECISIONS.md` | Repo-wide decision log (phases 1–5, role batches A–F, Triad/Vampire/Cult, the permanent-death rule). Read before reversing anything. |
| `DECISIONS-client.md` | Client TEST MODE god-view decisions (roomId workaround, store shape, gating). |
| `OPERATIONS.md` | Live deploy notes: pm2 map, entry-point gotcha, no-reboot persistence, build 404 window, the TEST MODE exposure. |
| `CLEANROOM.md` | Clean-room record: only `BUILD_SPEC.md` was consulted for expressive content; 1920s noir theme. |
| `docs/ADDING_ROLES.md` | End-to-end checklist for adding a role (shared → setups → engine → tests → leak → TEST MODE validation). |
| `README.md` | Human-facing overview, status, dev setup, env vars, test mode, Postgres. |
| `research/` | Pre-build research dossier (game design, engine stack, networking, Steam/legal, comparable games, adversarial critique). Predates the build; not consulted for expressive content. |

## Fleet hygiene

This repo is scanned by the `fleet-hygiene` loop on host `mrfox` (output in
`~/fleet-hygiene/out/mafia/`). The scan flagged the missing `AGENTS.md` you are
reading now. Keep this file accurate — it is the orientation entry point for the
next agent or operator.