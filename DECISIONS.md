# DECISIONS.md

A running log of decisions made where `BUILD_SPEC.md` is silent or leaves a
choice to the implementer. Per the spec preamble, we prefer the simplest
deterministic option and keep going. Each entry cites the relevant section.

Format: `[area] decision — rationale (spec ref)`.

---

## Phase 1 — Monorepo scaffold + `packages/shared`

### Theming & naming

- **[theme] Visual/voice theme is 1920s noir / Prohibition.** All player-facing
  copy (role descriptions, announcements, private results, error text) is
  written in that register. Chosen from the spec's suggested direction; recorded
  here as required. (§2.1.4)
- **[naming] `GAME_NAME = 'Nocturne'`** as the single working title constant in
  `constants.ts`. Never hardcoded elsewhere; user-facing strings interpolate it.
  (§2 codename note, §3)
- **[naming] npm scope is `@nocturne/*`** (`@nocturne/shared`, `/engine`,
  `/server`, `/client`, `/bots`). Internal package ids; not user-facing, so the
  codename here is acceptable and easy to rename later. (§4.1)

### Tooling & build

- **[tooling] Package manager pinned to `pnpm@9.15.9`** via `packageManager`,
  matching the installed version. (§4.1)
- **[tooling] TS module mode is `NodeNext` + ESM** across all packages
  (`"type": "module"`), with explicit `.js` import specifiers in TS source. This
  is the lowest-friction strict-ESM setup for Node 20 and Vitest. (§2.2, §4.1)
- **[tooling] `tsconfig.base.json` enables maximal strictness:** `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
  `verbatimModuleSyntax`, `isolatedModules`. Each package extends it with only
  `outDir`/`rootDir` (client also adds DOM libs). (§2.2 "TypeScript strict
  everywhere")
- **[tooling] ESLint flat config** (`eslint.config.js`) = `@eslint/js` +
  `typescript-eslint` recommended + `eslint-config-prettier`, with
  `consistent-type-imports` enforced and `_`-prefixed unused vars allowed. A
  scoped override gives the pre-existing `scripts/**/*.mjs` Node globals so the
  whole tree lints clean without reformatting that file. (§4.1)
- **[tooling] Prettier** config: single quotes, semicolons, trailing commas
  (`all`), width 100. (§4.1)
- **[tooling] Vitest workspace** lists the five `packages/*`; stub packages run
  with `--passWithNoTests` so `pnpm -r test` is green before they have tests.
  (§4.1, §12)
- **[tooling] Stub packages compile against `shared`** by re-exporting a
  protocol-version constant, so the dependency graph
  (engine→shared, server→shared+engine, client→shared, bots→shared+engine) is
  exercised by the build from day one. (§4.1)

### `packages/shared` structure & API

- **[shared] Enums are defined once as zod enums and the TS type is inferred**
  (`z.infer`). This keeps protocol schemas and exported types in lockstep — the
  single-source-of-truth requirement — for Phase, Faction, RoleId, ChatChannel,
  DeathCause, etc. (§9)
- **[shared] `Effect` is generic over the message type in `types/effect.ts`**
  (`AddressedEffect<TMsg>`) to avoid a cycle with the protocol module; the
  protocol module re-exports a concrete `Effect = AddressedEffect<ServerMessage>`.
  (§5, §6)
- **[shared] No `'spectator'` effect target.** Spectators receive exactly the
  `'public'` stream and never a secret regardless of `deadSeeAll`, so a separate
  target would be redundant and a footgun. Documented in `effect.ts`. (§5, §7.8)
- **[shared] Setup data model:** a setup is `{ id, name, description,
minPlayers, maxPlayers, townPool, slotsByPlayerCount }` where
  `slotsByPlayerCount` is keyed by the stringified player count. Auto-scaling
  setups have entries for 7..15; curated setups pin a single count. Slots are a
  discriminated union of `fixed` (a role) and `category` (`RANDOM_TOWN` /
  `RANDOM_MAFIA`). (§6.10)
- **[shared] Faction-composition is computed statically** (`setups/compose.ts`)
  because every MVP category pool is faction-homogeneous (`RANDOM_TOWN`→Town,
  `RANDOM_MAFIA`→Mafia). This lets the setup tests assert §6.10's faction table
  without invoking the (not-yet-built) engine PRNG draw. (§6.10, §12)

### Role data

- **[roles] `RoleDefinition` is plain data, no logic** — ability metadata
  (`nightAction`/`dayAction` kind, `targetScope`, metered `uses`), interaction
  flags (`unique`, `nightImmune`, `roleblockImmune`, `visits`), the §6.6
  investigation fields, and original copy (`tagline`/`description`/`winHint`).
  (§6.5)
- **[roles] `UNIQUE_ROLES = {Jailor, Mayor, Godfather, Serial Killer}`.** The
  spec names the first three as unique in §6.10; Serial Killer is "only one SK
  per setup in MVP" (§6.9), so it is flagged unique too. (§6.9, §6.10)
- **[roles] Serial Killer is NOT marked `roleblockImmune`.** The SK's
  roleblock interaction is the redirect hazard (blocker dies instead), which the
  engine implements; marking it `roleblockImmune` would suppress that hazard.
  The role is `nightImmune` and the hazard handles the rest. Documented inline.
  (§6.7)
- **[roles] Godfather/Jailor/Mayor/Survivor `visits=false` at the base level.**
  The Godfather only visits when personally performing the kill (no Mafioso) —
  modeled by the engine as a kill state, not a static flag; jailing is not a
  street visit; revealing/passive roles don't visit; a Survivor self-vest is not
  a visit. (§6.5)
- **[roles] Doctor unlimited heals with `uses.total = Infinity`, `selfTotal = 1`.**
  The Doctor heals every night; only the self-heal is metered (once/game). This
  is in-memory data only (never serialized), so `Infinity` is safe. (§6.5)
- **[roles] `FRAMED_INVESTIGATOR_CLASS = 'R6'`.** §6.5 #13 says a framed target
  reports "result class containing Mafioso"; R6 is that class (§6.6). The static
  per-role table reflects un-framed results; framing is an engine override. (§6.6)

### Constants & caps

- **[constants] General chat text cap = 256 chars.** §6.4 fixes whisper (256),
  will (500) and death note (256) but leaves the general chat cap open; 256
  matches the whisper/note cap for one mental model. (§6.4)
- **[constants] Display-name cap = 24 chars** (spec-silent) — chosen for player-
  list UI fit. (§7)
- **[constants] Report comment cap = 1000 chars** (spec-silent) — generous free
  text for a moderation note. (§11.1)
- **[constants] `firstPhase` default = `'day_no_lynch'`** and it is the only MVP
  value, per §6.1. `deadSeeAll` default = `true` (private-lobby default); the
  server flips it to `false` when creating a public lobby. (§5, §6.1)

### Protocol

- **[protocol] `ClientMessage` / `ServerMessage` use `z.union`, not
  `z.discriminatedUnion`.** Two messages can't be bare `ZodObject`s:
  `join_lobby` carries a `.refine` (needs id or code) and `private_result` is an
  envelope `.and()` a discriminated payload union. `z.union` over the same
  `type`-literal shapes is unambiguous and the tests confirm every example
  round-trips. (§9)
- **[protocol] `private_result` payloads are a discriminated union on `kind`**
  with typed variants for sheriff/investigator/lookout results and the flag-only
  notices (roleblocked, target_unreachable, was_healed, …). (§9.2, §6.7, §6.8)
- **[protocol] Error codes are an enumerated, stable set** in `protocol/errors.ts`
  (machine keys) with human copy in `strings.ts`. The list covers transport,
  lobby, and in-game command-validation failures from §5.5/§9. (§9)
- **[protocol] `parse*`/`safeParse*` helpers** are the import surface for the
  server/client so neither hand-rolls validation. (§9)

### Curated setups (designed by implementer, §6.10)

Both are pinned 15-player setups drawn from the same 17-role pool, designed to
play differently from Classic Nocturne:

- **[setup] "Cross-Examination" (15p)** — an investigation duel. Town(9):
  Sheriff, Investigator×2, Lookout, Doctor, Jailor, Escort, Mayor, +1
  `RANDOM_TOWN` (from a support pool). Mafia(3): Godfather, Mafioso, Framer.
  Neutral(3): Serial Killer, Jester, Executioner. Reasoning: stacks the Town
  with information roles, then hands the Mafia a Framer to poison every read and
  an SK to punish misplaced trust — the information layer is the whole game.
  Uses a `RANDOM_TOWN` slot to exercise the category system.
- **[setup] "Gunsmoke" (15p)** — a high-bodycount brawl. Town(8): Jailor,
  Vigilante×2, Doctor×2, Sheriff, Lookout, Citizen. Mafia(3): Godfather,
  Mafioso, +1 `RANDOM_MAFIA`. Neutral(4): Serial Killer, Survivor, Jester,
  Executioner. Reasoning: maximizes night kill pressure (2 Vigilantes + SK +
  Mafia) and counterbalances with extra Doctors and a Survivor, so claims get
  tested with bullets rather than talk. Uses a `RANDOM_MAFIA` slot.

### Executioner target exclusion (§6.5 #17)

- **[roles] Executioner's assigned target excludes the Jailor** (per the spec's
  explicit instruction) — and, as the natural generalization, must be a Town
  seat that is not the Jailor. The actual draw happens in the engine; `shared`
  only records the constraint here. The Jailor is excluded because an
  Executioner driving the town to lynch a claimed-and-checkable Jailor produces
  degenerate, low-information games. (§6.5 #17)

### Mafia succession (§6.5 #11)

- **[roles] On Godfather death with no living Mafioso, the senior remaining
  mafia member (Consort/Framer) converts to Mafioso.** This is engine behavior;
  `shared` records the rule here as required by §6.5 #11. The "senior" tiebreak
  is the lowest seat index among living mafia, to keep it deterministic — the
  engine will own the exact implementation. (§6.5 #11)

---

## Phase 2 — `packages/engine`

Engine-local decisions: spec-silent choices and gaps in `@nocturne/shared` that
the engine had to fill.

### PRNG (§2.2, §4.3)

- **[prng] mulberry32 seeded by FNV-1a over the seed string.** One 32-bit PRNG
  state lives in `GameState.prng` (a plain number) so the whole state stays
  JSON-serializable and replayable. All randomness (role assignment shuffle,
  category-pool draws, Executioner target, Jester-grief victim) flows through it.
  Rationale: tiny, fast, well-distributed, trivially serializable — replaces
  SC2Mafia's "repeat a random number of times" non-determinism with an exact,
  auditable generator. The full state hashes byte-stably (`hashState`,
  canonical-JSON + FNV-1a-64).

### Public API surface (§6)

- `init(setup, seed, opts?) → GameState` — `opts.playerCount` selects the slot
  list for auto-scaling setups; `opts.names`, `opts.config`, `opts.matchId` are
  optional. `init` leaves the state in phase `ASSIGN` with `phaseEndsAt: null`;
  the server emits `your_role` (via `yourRoleEffect`) then drives a `phase_end`
  to enter `DAY_0`.
- `apply(state, event) → { state, effects }` — pure; clones input, never mutates.
- `nextDeadline(state) → { phase, endsAt } | null`.
- Extra exports the server needs: `yourRoleEffect`, `abilityInfoFor`,
  `roleToNightAbility`, `hashState`, and the PRNG primitives.

### Night ability keys (§6.8)

- **[engine] Concrete `NightAbility` union** distinct from shared's
  `NightActionKind`: `kill_vigilante | kill_mafia | kill_serial | kill_jailor |
  mafia_control | roleblock | protect | vest | frame | investigate_sheriff |
  investigate_investigator | watch`. The server maps a seat's role to its key via
  `roleToNightAbility`. **Gap:** shared has no concrete per-source kill enum;
  defined locally. The Jailor execution is its own key `kill_jailor` (only valid
  on the jailed prisoner with executions remaining) — keeps execution semantics
  (pierces heals/immunity) unambiguous and separate from the day jail-select
  (`day_ability: 'jail'`).

### Roleblock fixed point (§6.7)

- **[engine] Grounded-propagation + cycle override.** The plain rule "a block is
  inactive if its blocker is targeted by an active block" has two consistent
  fixed points for a pure cycle (both active / both inactive); §6.7 explicitly
  selects *both active*. Implemented as: (1) propagate blocked-ness from
  *grounded* sources (a blocker that is immune or targeted by no block), killing
  chained downstream blocks (`A→B→C ⇒ B blocked ⇒ C acts`); (2) any block whose
  blocker survived grounding belongs to a cycle and stays active (`A↔B ⇒ both
  blocked`). This fixed point is unique and order-independent (property-tested
  with 200 random graphs).

### Mafia kill performer & visits (§6.5, §6.8)

- **[engine] `mafia_control` (Godfather) never visits; `kill_mafia` (the
  performer) visits.** The Lookout attributes the mafia-kill visit to the
  performer, never to the Godfather. When no Mafioso is alive, the Godfather
  performs the kill himself — modelled by **mafia succession** converting the
  senior mafia to `MAFIOSO` (who then submits `kill_mafia`). The GF only visits
  in the specific turn he is the performer; in MVP the succession makes a Mafioso
  the standing performer, matching the spec's intent.

### Mafia succession (§6.5 #11)

- **[engine] Senior = lowest living-mafia seat index.** When the Godfather dies
  and no Mafioso lives, the lowest-seat living mafia becomes `MAFIOSO` during the
  bookkeeping step (effective next night). Consort/Framer convert to Mafioso.
  Faction stays `MAFIA`.

### Win conditions (§6.9)

- **[engine] 1v1 auto-resolve** only fires at the start of `DAY_VOTING`
  (`checkWin(state, { atDayVotingStart: true })`): SK vs lone Mafia ⇒ SK; SK vs
  lone Town ⇒ SK (priority SK > Mafia > Town). Mafia-vs-Town parity is already
  covered by the standing parity rule.
- **[engine] Stalemate guard** is a separate check (`checkStalemate`) evaluated
  after night resolution; 3 consecutive zero-death nights end the game with the
  largest living faction winning (tie ⇒ Mafia; SK is a faction of 1 and wins ties
  over Mafia).
- **[engine] Riders** (Survivor alive, Jester/Executioner personal wins) are
  folded into the winners list at game over; personal wins are recorded at the
  lynch/conversion moment.
- **[engine] All-dead ⇒ DRAW** (degenerate simultaneous-kill case), with every
  seat outcome `loss` (no win flag).

### Phase timing & logical clock (§6.1, §6.2)

- **[engine] Deadlines computed from `event.ts` + config durations.** The engine
  reads no wall clock; every `GameEvent` is server-stamped with `ts`. DAWN length
  is `8s + 4s/death`; EXECUTION 12s; both fixed. Trial pauses the `DAY_VOTING`
  timer (`nomination.pausedRemainingMs`) and resumes the remaining time on an
  innocent verdict; the third innocent ends the day.
- **[engine] `dayNumber` increments at `DAY_DISCUSSION` (start of each day);
  `nightNumber` increments when entering `NIGHT`.** The Vigilante N1 guard and
  similar "not night 1" rules read `nightNumber`. (MVP note: the engine does not
  itself reject a Vigilante N1 shot — the server validates ability legality per
  §5.5 before forwarding; the engine trusts validated commands.)

### Chat entitlements (§5, §6.4)

- All channel addressing lives in the engine: `day` → public; `mafia` → living
  mafia seats; `jail` → `[prisoner, jailor]` with the jailor's sender masked to
  the literal `"Jailor"` for the prisoner; `dead` → dead seats. Rate limiting is
  the **server's** job (not in the engine, per §6.4).

### Gaps noted in `@nocturne/shared` (engine)

- No concrete per-kill-source night-ability enum (defined `NightAbility` here).
- No `GameState` / `GameEvent` / `ResolutionTrace` types (the engine owns these
  and re-exports them, per §6).
- `RANDOM_TOWN` pool draw uses `setup.townPool`; shared exposes `RANDOM_MAFIA_POOL`
  but no `RANDOM_TOWN` constant — the engine reads the setup's `townPool` field.

### Testing (§12.1)

- 47 tests across 7 files: §6.8 golden cases (`night.test.ts`), §6.3 day/trial &
  Jester/Exe/succession/leaver (`day.test.ts`), §6.9 win checks (`win.test.ts`),
  §6.10 assignment (`init.test.ts`), determinism + termination + block fixed-point
  uniqueness (`property.test.ts`, fast-check), §5 leak detector (`leak.test.ts`),
  and the §4.3 purity guard (`purity.test.ts`).
- **Determinism guard:** `test/purity.test.ts` statically scans `src/` for
  `Date.now` / `new Date` / `Math.random` / `performance.now` / `process.hrtime`
  / `crypto.randomUUID`. An engine-local `eslint.config.js` adds the equivalent
  `no-restricted-syntax` rule for `pnpm --filter @nocturne/engine lint`.

---

## Phase 3 — `packages/server`

Spec-silent or integration decisions made while implementing the server.

### Engine integration

- All engine touchpoints are isolated in `src/engine-adapter.ts` per the task's
  HARD BOUNDARIES. The adapter declares the §6 interface **locally** (`EngineApi`:
  `init/apply/nextDeadline`, `Effect = {to, msg}`) plus an `EngineView`
  (mafia/dead/all seats, phase info, isOver, per-seat view, `yourRole`,
  `abilities`, `nightAbilityFor`, `gameOver`) the transport/snapshots need.
- **The real `@nocturne/engine` is wired up.** The engine exposes a clean,
  JSON-serializable `GameState` plus helpers `yourRoleEffect` / `abilityInfoFor` /
  `roleToNightAbility`. The adapter dynamically imports it; if usable it binds the
  real engine and derives the `EngineView` from that shape.
- **Event protocol:** the engine's events carry `ts` (its only clock) and use
  concrete `NightAbility` keys. The server maps a seat's role to its night ability
  via `engine.nightAbilityFor(role)`; chat/whisper/wills/votes/verdicts/
  day-abilities/seat_left are forwarded to the engine, which owns channel
  entitlement (§5/§6.4). The server only sanitizes text (§11.6), rate-limits
  (§6.4), and enforces mutes (§11.2) before forwarding.
- **Phase broadcasting:** the engine emits the authoritative `phase_change`
  effect on `phase_end`; the Room does NOT re-broadcast phase — it mirrors
  `phase`/`dayNumber`/`endsAt` from `phaseInfo` into its own fields for resume
  snapshots and deadline scheduling.
- **Fallback engine retained** (`src/engine-fallback.ts`) as a deterministic
  in-server backup if the engine is ever absent (no `init`/`apply`). A simplified
  subset of §6; selected only when the real engine is missing
  (`isUsingFallbackEngine()` reports which is active). **Not a rules-fidelity
  substitute.**
- **Mute limitation:** server-enforced mutes (§11.2) suppress whisper content
  only; per-recipient filtering of broadcast day/mafia/dead chat is out of MVP
  scope (the engine emits one addressed effect per channel, not per recipient).
- **Clock seam (now threaded).** `Room` takes injectable `schedule`/`clock`
  params (§6.2); `LobbyManager` now threads them from `ManagerDeps.schedule`/
  `clock` → `new Room(...)` in `startGame`. Production leaves them undefined (real
  `setTimeout`/`Date.now`); tests/sims inject a deterministic clock. This unlocked
  the previously-skipped full timer-driven game-loop and reconnect-equivalence
  integration tests, which now drive a `FakeClock` (advance virtual time → every
  phase deadline fires; no wall-clock waits).
- **`NOCTURNE_TIMESCALE` evaluated and deliberately NOT shipped.** The intent was
  an env var that scales phase durations for accelerated socket sims, per the
  task's "scale the lobby-config timings at lobby creation" suggestion. Two
  candidate seams were both found unclean:
  1. *Scale `lobby.config.timings` at creation.* `config` is echoed in the
     wire-validated `lobby_state`/`game_started` frames, whose `timings` are
     validated against the **host-tunable** `PHASE_TIMING_BOUNDS` (e.g. NIGHT
     min 30). Sub-bound scaled values (NIGHT 6) fail the transport's outbound
     re-validation and the frame is **dropped** — clients would never receive
     lobby/game state. Clamping back to the bounds reduces the speedup to exactly
     what the existing min-bound `FAST_TIMINGS` already give, making the var
     pointless.
  2. *Scale the engine-authored `endsAt` at the Room layer.* The engine computes
     deadlines (including fixed DAWN `8s+4s/death` and EXECUTION 12s) from
     `event.ts`. Rewriting those in the Room would desync the `endsAt` rendered by
     clients (which count down from it) and stored in resume snapshots.
  Neither is clean, so per the task's "only if clean; otherwise leave sims as-is
  and note why" the var is not added. Accelerated socket sims continue to use the
  min-bound lobby timings; the FAST engine simulator remains the primary path for
  bulk sweeps (it bypasses wall time entirely). The injectable clock seam above is
  the durable, clean win from this pass.

### Information security (§5)

- The §5 invariant is enforced by `src/transport.ts`: the ONLY socket-send paths
  are `ScopedTransport.{sendTo,broadcastPublic,dispatchEffect}` and the bare
  `sendToSocket` (welcome/error/pong pre-lobby). `rawSend` is private and
  **re-validates every outbound frame** against `ServerMessageSchema` in
  non-production (defense-in-depth).
- **Lint guard:** `packages/server/eslint.config.js` forbids `socket.send(...)`
  outside `transport.ts` (`no-restricted-syntax`). The root config is off-limits
  to the server agent, so the guard is server-local.
- Spectators are never in any seat audience; `dispatchEffect` routes `mafia`/
  `dead` only to engine-derived seat sets, so spectators receive `public` only
  regardless of `deadSeeAll` (§7.8).

### Persistence (§10)

- DB driver: **`pg`** (not Drizzle) — simplest, no codegen step.
- `NO_DB=1` selects `MemoryStore` (guests-only, no persistence, warn log). When
  `DATABASE_URL` is unset and `NO_DB` is also unset, the server **defaults to the
  memory store with a warning** rather than crashing, so a bare
  `node dist/index.js` boots.
- `chat_messages` is `PARTITION BY RANGE (created_at)` with a DEFAULT partition;
  weekly-partition maintenance + 90-day retention is an **operational cron job**,
  not server code.
- The migration runner (`src/db/migrate.ts`) applies `schema.sql` idempotently
  (every statement `IF NOT EXISTS`). `schema.sql` is read from next to the
  compiled file; the build copies it into `dist/db/`.
- Dev Postgres `docker-compose.yml` maps host port **5433** (not 5432) to avoid
  clashing with other containers.

### Auth & identity (§7.1, §10)

- Password hashing: **`argon2`** npm (argon2id), wrapped in `auth/passwords.ts`.
- Session tokens are random 256-bit; only `sha256(secret:token)` is stored. The
  same token authenticates HTTP (httpOnly cookie `nocturne_session`) and WS
  (`hello.token`). Guest sessions live in-process (no DB row), so guests work in
  `NO_DB` mode.
- Guests may join/create **private lobbies only** (§7.1); creating a public lobby
  as a guest is rejected with `forbidden`.

### Misc spec-silent choices (server)

- **Display names** for accounts are also the lobby handle (no separate display
  name field in MVP). Guest names are original noir handles (`ids.ts`).
- `report_player` evidence: the server attaches the last ≤50 chat-context entries.
- **Admin auth** accepts either the `isAdmin` user flag or an `x-admin-token`
  header matching `ADMIN_TOKEN` (bootstrap for solo ops). Every admin action is
  logged to `admin_audit`.
- **AFK** is flagged after `AFK_PHASE_THRESHOLD` (2) actionless phase boundaries;
  any command resets the idle counter (`Room.notedAction`). No auto-kill / bot
  takeover (§8 MVP).
- **Play again** (§7.7): the game-over handler persists the match and logs; the
  "roster flows back into a fresh lobby" loop is left to the host re-creating a
  lobby (roster identities available via `Room.rosterIdentities()`).

---

## Phase 4 — `packages/client`

Client decisions where the spec or `@nocturne/shared` is silent. The client only
touches `packages/client/`; it depends on `@nocturne/shared` plus react/vite deps
and never imports the engine/server.

### Stack & tooling

- **[stack] React 18 + Vite + TypeScript strict.** tsconfig extends the repo base
  (strict + `exactOptionalPropertyTypes`), overridden to `jsx: react-jsx`,
  `moduleResolution: Bundler`, `noEmit` (Vite emits; `tsc` only typechecks).
- **[state] State lives in a single `zustand` store.** Server-message handling is
  a *pure* `reduce(state, msg)` (`store/reducer.ts`) kept separate from the
  zustand wiring so it is trivially unit-testable; the store also holds
  client-only state (settings, clock samples, optimistic own-action selections).
- **[router] `react-router-dom` (BrowserRouter).** Routes `/`, `/join/:code`,
  `/lobby/:id`, `/game`, `/settings`. History routing (not hash) so invite links
  are clean; the production server serves `index.html` for unknown paths (SPA
  fallback).
- **[deps] Client depends on `@nocturne/shared` + react/react-dom/react-router/
  zustand only.** No direct `zod` import; `lib/api.ts` narrows HTTP responses by
  hand. All *protocol* validation uses the zod schemas re-exported from shared.

### Protocol & WS layer

- **[ws] Single connection manager (`ws/connection.ts`), native WebSocket.**
  Handshake sends `hello {token?, protocolVersion}` on open; `welcome` rehydrates
  the store (resume snapshot, §8). Auto-reconnect with exponential backoff
  (500ms→15s) + 30% jitter. Inbound frames are `safeParseServerMessage`-d
  (unknown/invalid ignored); outbound frames are `ClientMessageSchema`-validated.
- **[clock] Clock offset estimated SNTP-style** from `ping`/`pong t`: offset =
  `serverT - localMidpoint`, keeping the lowest-RTT sample (`lib/clock.ts`).
  Countdowns render `endsAt - (localNow + offset)`, never a locally-counted timer
  (§6.2). Ping cadence 5s.
- **[token] Session token persisted in `localStorage` (`nocturne.token`)** and
  sent over WS `hello`, mirroring the httpOnly-cookie path. HTTP API called with
  `credentials: 'include'`.
- **[force_update] `force_update` flips connection state** and shows a
  non-dismissible refresh modal; reconnect is suppressed in that state.

### HTTP API contract (assumed; server-owned)

- **[api]** The client assumes `POST /api/{login,register,guest}` →
  `{token?, userId?, guestId?, name?}`; `GET /api/lobbies` →
  `{lobbies: [{id,name,players,capacity,setupId,status}]}`. Responses are narrowed
  defensively; the lobby browser degrades to empty on failure. If the server
  differs, only `lib/api.ts` changes.
- **[invite] The `/join/:code` route sends `join_lobby {inviteCode}`**; the lobby
  "copy link" produces `/join/<lobby.id>` because the client is not separately
  told the invite code in `lobby_state`.

### Game UI behavior

- **[channels] Chat tabs are offered from received traffic + context, never
  fabricated** (`lib/channels.ts`): `day` always; `mafia`/`jail`/`dead`/`whisper`
  only when traffic was received there or the seat is contextually in that state.
  Entitlement is server-enforced; the client only decides which tabs to *show*.
- **[abilities] Night/day actions are addressed by `AbilityInfo.id`** from
  `your_role.abilities`; the server validates ability legality authoritatively.
- **[death-note] Death-note editor is shown to plausible holders** (SK, Mafioso,
  Godfather); the server is authoritative on acceptance.
- **[targets] Night target legality is filtered client-side as a hint** (UX only;
  the server re-validates).
- **[mayor-reveal] Mayor reveal requires a `window.confirm`** before sending
  `day_ability {reveal}`.
- **[autosave] Last-will / death-note editors debounce 600ms** and re-sync from
  resume snapshots without clobbering in-flight edits.
- **[play-again] "Play again" calls the local `resetGame()`** — there is no
  `play_again` protocol message; the group re-readies in the same lobby.
- **[mute] Player mute is stored locally by seat index** (display mute); §11.2's
  server-enforced per-account mute is wired for eventual enforcement (partial).

### Visual identity & accessibility

- **[theme] Original 1920s noir / Prohibition, CSS-only.** Dark charcoal,
  brass/amber art-deco accents, serif display type. No external assets; original
  inline SVG glyphs. No StarCraft / Town of Salem references.
- **[scene] Day/night scene tinting** via a `data-scene` root attribute mapped
  from phase. Pure CSS.
- **[colorblind] Faction is ALWAYS color + icon + label.** The colorblind toggle
  swaps to a higher-contrast hue set; faction icon + text label always render, so
  color is never the only signal. Text-scale scales a root `--scale` variable.
- **[profanity] Display-only profanity mask** (small client wordlist) at render
  when toggled; the authoritative filter is server-side (§11.4). Never blocks
  sending.

### Security / sanitization

- **[xss] All server text is rendered as plain text.** React escaping is primary;
  `lib/sanitize.ts` additionally strips C0/C1 control chars (keeping `\n`/`\t`),
  zero-width + bidi-override spoofing characters, normalizes CRLF, and hard-caps
  length. No `dangerouslySetInnerHTML`, no markdown.

### Strings & shared gaps (client)

- **[strings] All shared copy comes from `@nocturne/shared` `strings`.** Copy the
  shared module does not provide is in `src/lib/strings-extra.ts` (same noir
  register); shared was NOT edited. Locally-defined copy candidates to fold back
  into shared: home/auth/lobby-browser copy, lobby-screen copy, game-screen copy,
  settings-screen copy, display maps (`FACTION_LABEL`/`WINNER_LABEL`/
  `OUTCOME_LABEL`/`TRIAL_OUTCOME_LABEL`/`VERDICT_LABEL`), 1-based seat labelling.
- **[shared-gap] `lobby_state.lobby` exposes no invite-code field** for private
  lobbies, so "copy link" uses the lobby id in `/join/<id>`.
- **[shared-gap] No `play_again` client message** in §9.1; "play again" is a local
  return to the lobby view.

---

## Phase 5 — `packages/bots`

Bot/sim/leak-detector decisions (§12.2/§12.3/§12.4).

### Architecture

- **[bots] Bots are REAL protocol clients over `ws`.** `BotClient` opens a real
  loopback WebSocket to the real server, sends `hello`, and thereafter speaks the
  shared zod protocol exactly like the human client. It parses every inbound frame
  with `ServerMessageSchema` (invalid frames ignored, never crash) and validates
  every outbound frame with `ClientMessageSchema`. No engine access for play
  decisions.
- **[bots] The bot keeps only a human-equivalent view.** `BotView` holds own
  role/mates/abilities, the public seat & alive set, phase, vote tallies, the
  active trial — all derived solely from received frames. It never holds another
  seat's secret because the server never sends one.
- **[bots] Own seat NUMBER is injected by the orchestrator, not inferred.** The
  server seats players in roster (= join) order, host first, so the sim assigns
  `setSeat(joinIndex)`. Resume snapshots carry the seat explicitly.

### Policy (§12.2 heuristics)

- **[bots] Seeded mulberry32 PRNG per bot** (`rng.ts`), separate from the engine
  PRNG. Per-bot seed = `${gameSeed}:bot:${i}`.
- **[bots] Mafia coordinate via mafia chat + night_action.** The lowest living
  mafia seat proposes a random non-mafia target in `mafia` chat, then all mafia
  killers submit `night_action` on it. Town roles act on random legal targets;
  everyone votes randomly with a small chance to follow the tally; verdicts are
  random-weighted (slight guilty lean so games progress). Jailor jails from Day
  1+, Vigilante respects the no-Night-1 rule, Doctor protects, Mayor sometimes
  reveals from Day 2.
- **[bots] Canned chat lines are written fresh for NOCTURNE** (cleanroom, §2.1.2),
  1920s-noir register.

### Clock seam / timescale (resolved)

- **[bots] The clock seam now exists end-to-end (but does not change the sim
  strategy).** Earlier the bots noted that `LobbyManager.startGame` constructed
  `new Room(...)` WITHOUT threading the injectable `schedule`/`clock`, so socket
  games could only be accelerated via the lobby-config min-bound timings
  (`FAST_TIMINGS`). The integration pass threaded the seam
  (`ManagerDeps.schedule`/`clock` → `Room`), which unlocked deterministic
  server-side integration tests — but the seam is **per-Room and server-internal**;
  the bots talk to the server over real sockets and cannot inject a clock into a
  remote Room. A `NOCTURNE_TIMESCALE` env var to scale phase durations was
  evaluated and **not shipped** (it would either break the wire-validated `config`
  echo or desync client countdowns — see the server Phase 3 entry). So socket sims
  are left as-is: they continue to use the min-bound lobby timings, and the FAST
  engine simulator below remains the primary bulk-sweep path.
- **[bots] FAST engine simulator for the bulk runs** (`sim-engine.ts`) drives the
  REAL engine directly (`init`/`apply`/`nextDeadline`), advancing phases by
  feeding `phase_end` events whose `ts` equals the engine's own `phaseEndsAt` — a
  full game resolves in well under a millisecond of logical time. It REUSES the
  same `BotPolicy` heuristics and the SAME effect→recipient routing the server's
  `ScopedTransport` uses, so the per-seat captures fed to the leak auditor are
  identical in shape to the socket path. FAST runs the bulk determinism / 200-game
  leak sweeps; the socket path runs a small number of full games for real-protocol
  integration. (§12.2 FAST-path clause, §12.3 ≥200 games)

### Leak detector (§12.3)

- **[bots] The auditor combines a TYPED structural check with a CROSS-CAPTURE
  deep scan.** Typed: secret-bearing frame types (`your_role.mates`,
  `chat_message` channel `mafia/jail/dead`, `whisper`, `private_result`) must
  reach only entitled seats; spectators get none. Deep scan: using true roles from
  the legal `game_over` reveal as ground truth, no frame may carry another seat's
  role id in a STRUCTURED field before that seat is legally revealed.
- **[bots] Free-text fields (`text`) are excluded from the deep scan** — a player
  may legitimately *claim* a role in day chat. The scan targets structured
  role-typed fields, which are server-authored facts (`auditor.test.ts` proves it
  both ways).
- **[bots] deadSeeAll handling is conservative.** The server's transport never
  routes extra secrets to the dead even when `deadSeeAll=true`, so the hard
  invariants are: non-mafia never get mafia chat; spectators never get any secret.
- **[bots] Two surfaces:** a bounded vitest (`leak.test.ts`, ≥20 seeded games) and
  `pnpm leakcheck --games 200` (full §12.3 sweep, engine FAST path).

### Fuzz & abuse (§12.4)

- **[bots] Tests drive the REAL in-process server over real sockets** (NO_DB):
  malformed JSON, unknown types, out-of-phase commands, oversized (>8 KB) frames,
  a 2000-frame garbage burst, connection-level rate-limit spam. The server replies
  `error` where required and stays up.
- **[bots] Stable identities via `POST /api/guest`.** Takeover asserts the older
  socket is closed with code 4000 ('superseded'); resume asserts the rebuilt
  snapshot's own role/seat/alive-set/entitled-chat match a never-disconnected
  observer's public view + the resumer's own private log.

### dev:solo (§12.2)

- **[bots] Bots create the lobby; the human joins via the printed invite link.**
  `dev:solo` boots the real server (NO_DB=1, PORT 8080) in-process and spawns
  8–14 bots. The host bot creates a PRIVATE lobby; since the public lobby DTO omits
  the invite code, the sim reads it directly from the in-process `LobbyManager`
  and prints `http://localhost:8080/join/<CODE>`. `--autostart` starts with bots
  only.

### Setup id spelling

- **[bots] Accept both `classic_nocturne` (spec spelling) and `classic-nocturne`
  (the data id).** The CLIs normalize underscores→hyphens for all three shipped
  setups.

---

## Post-MVP buildout (points, replays, admin, custom setups, animations, roles)

These extend beyond the MVP into BUILD_SPEC's deferred/Phase-B territory, per an
explicit product goal to port more of the SC2Mafia experience. The MVP invariants
hold throughout: the engine stays pure/deterministic; secrets travel only via
addressed effects through the single ScopedTransport; the bots leak auditor gates
every protocol change.

### Points & achievements (goal 4)

- **[points] Scoring is a pure function in `@nocturne/shared` (`types/points.ts`),
  computed server-side at match end — never in the engine.** Keeping it out of
  `apply`/`resolveNight` preserves replay determinism (a synthesis-flagged risk).
  Weights: played 10, win 50, survived-to-end 25, loyalty 6/day-dead (cap 72),
  plus achievement bonuses. (goal 4)
- **[points] Guests (`guest:` identities) and TEST-mode games are excluded** from
  stats/achievements/leaderboard so the ladder isn't polluted.
- **[points] Progression tiers** (Drifter/Made/Capo/Boss/Kingpin) drive cosmetic
  perks like points-keyed death animations later (goal 3).

### Replay integrity (goal 9)

- **[replay] `matches.fingerprint` = `sha256:<HMAC>` over a canonical (recursively
  sorted-key) match core**, keyed by the server secret. Sorted keys make it stable
  across Postgres JSONB round-trips; verify-on-read attaches an integrity verdict.
- **[replay] Full chat is now persisted** (`Room.chatLog`) so replays/exports are
  complete (previously `chat: []`). Export endpoint is participant/admin gated.

### Admin god-powers (goal 8)

- **[admin] In-game powers via one `admin_action` WS message**, gated on
  `identity.isAdmin`, every action logged to `admin_audit`.
- **[admin] kill & stump are new engine events** (`admin_kill`, `admin_stump`) so
  they are logged and replayable; points/ban/force-phase are server-side only.
- **[admin] A "stump" is `alive` but `stumped`: faction forced to TOWN, vote
  weight 0, night/day actions rejected, removed from the mafia roster.** A public
  leak-safe `seat_transform` frame announces it.

### Custom setups & setup-of-the-day (goals 10 & 11)

- **[setups] Validation, chaos, and daily rotation are PURE functions in
  `@nocturne/shared`** (`setups/validate.ts`, `setups/chaos.ts`,
  `setups/daily.ts`) — no `Date.now`/`Math.random`. The chaos generator and daily
  rotation are SEEDED via a shared-local PRNG (`setups/prng.ts`, FNV-1a +
  mulberry32, mirroring `engine/src/prng.ts`) so `shared` keeps no engine
  dependency while staying deterministic. The SERVER supplies the date string to
  the daily helpers (`new Date().toISOString().slice(0,10)` is allowed in the
  server, never in engine/shared). (goals 10, 11)
- **[setups] `validateSetup` runs before any custom/generated setup is persisted
  or used to create a lobby.** A malformed setup can crash engine `init()`, so the
  validator checks per-count slot==count, real role ids, unique roles ≤1 per
  count, faction-homogeneous & non-empty `RANDOM_TOWN` pools, and at least one
  killing role (any MAFIA slot, any `nightAction:'kill'` role, or a Jailor's
  execution) so a game can always end. A MAFIA-faction slot counts as killing
  because the standing faction kill always lands even with a Godfather (whose
  `nightAction` is `control`). (goal 10)
- **[setups] `chaosSetup(seed)` builds a multi-count (7..15) auto-scaling setup;
  `chaosSetup(seed, count)` pins one count.** The multi-count form lets a
  `chaos:<seed>` id behave exactly like a shipped setup through the lobby/start
  path, so no chaos seed needs separate persistence. Each count: Godfather +
  Mafioso core, scaling Mafia support (3 mafia at 12+), a Serial Killer at 10+,
  and the rest random Town (unique roles never doubled, Citizen pads any gap).
  Original noir name/copy ("Anything Goes"). (goal 11)
- **[setups] Lobby setup resolution is centralized in
  `LobbyManager.resolveSetup`** and routes by id prefix: `custom:` (async store
  read → `unknown_setup` if missing), `chaos:` (generated), else shipped. The
  resolved `GameSetup` is stored on the `Lobby` (`resolvedSetup`); `startGame`,
  `canStart`, the join cap, and `publicLobbyList` all read it instead of
  re-calling `getSetup(setupId)`, so custom/chaos setups work end to end.
  `createLobby` became `async` (one call site: `ws/handlers.onCreateLobby`). A
  resolved setup that fails `validateSetup` is rejected as `unknown_setup`. (goal 10)
- **[setups] Custom setups persist in `custom_setups` (JSONB) keyed
  `custom:<uuid>`; `scheduled_setups` is the optional admin-override table for
  setup-of-the-day** (the daily feature is otherwise computed purely). The
  MemoryStore (NO_DB) keeps custom setups in a process Map so the resolution path
  is testable without Postgres. The `POST /api/setups/custom` route is
  registered-users-only (guests 403), so building setups needs an account. (goals 10, 11)

## Role expansion batch A (Consigliere, Forger, Janitor, Bodyguard, Blackmailer, Veteran)

Six roles ported from the SC2Mafia lineage with ORIGINAL noir copy (no coined
source names, no copied text). Each was shipped end-to-end (shared role def →
`role.ts` id → `roles/index.ts` registry + investigator class → `roleinfo.ts`
ability map → `resolve.ts`/`apply.ts` handling → trace variant → `leak.ts`
KNOWN_ROLES → strings → a setup → engine golden test), keeping the FULL gate
green (`pnpm -r build`/`test`, eslint, leakcheck 0/200) after EACH role.

- **[batch A] New curated 15p setup `smoke-and-mirrors` ("Smoke and Mirrors")**
  showcases the expanded roster and is the dedicated leak-sweep target for the
  new roles (added to `SETUPS`, `daily.ts` rotation, and the leakcheck
  `SETUP_MAP`). Grown role-by-role as the batch shipped. The default leakcheck
  gate stays `classic-nocturne` 9p; the new roles are additionally swept at 15p.

- **[batch A · Consigliere] Mafia exact-investigate.** New `NightAbility`
  `investigate_consigliere`; new `private_result` kind `consigliere_result`
  carrying `{ target, role }` — the FIRST private result to deliver another
  seat's true role string. It is addressed via `toSeat([consigliere])` only, so
  the §5 addressing IS the entitlement. Both leak auditors (engine
  `test/leak.test.ts` `auditEffect`, bots `leak.ts` `mentionsRoleForOtherSeat`)
  were taught to treat `consigliere_result` as a LEGITIMATE per-seat role carrier
  (exactly like `your_role` for self / `death_announce` for the dying seat); the
  whitelist is scoped to that one structural frame so any accidental broadcast of
  a role in any OTHER frame type is still caught. The Consigliere reads the TRUE
  role even through a Framer (framing only fogs sheriff/investigator). Sheriff
  reads it suspicious (mafia support, like Consort/Framer); investigator class
  R3 (mixes Investigator/Jester/Consigliere). Added to `RANDOM_MAFIA_POOL` so a
  classic 12p RANDOM_MAFIA slot can draw it.

- **[batch A · Forger] Mafia counterfeit will.** New `NightAbility` `forge`
  (visits like a frame); new trace `{ step:'forge', forger, target, applied }`.
  REUSES the Forger's existing per-seat `deathNote` field as the prepared
  counterfeit-will text (no new event/protocol/seat-state surface) — the client
  surfaces the death-note editor to the Forger via `canKeepDeathNote`. `resolve.ts`
  records `forgedWillByTarget` in the deception step; if the marked seat dies that
  night, the death record carries `forgedWill`, and `apply.ts`'s DAWN
  `death_announce` shows the forged will instead of the victim's real one (even
  if the victim left no will). `applied` reflects whether the mark actually died.
  No private result for the Forger (the forgery is read publicly over the body).
  Sheriff reads it not-suspicious (detection-immune, distinct from the Framer);
  investigator class R8 (Framer/Lookout/Forger). Added to `RANDOM_MAFIA_POOL`.

- **[batch A · Janitor] Mafia body-cleaner (3 uses).** New `NightAbility` `clean`
  (visits); new trace `{ step:'clean', janitor, target, applied }`; new
  `private_result` kind `janitor_result` `{ target, role, lastWill? }`. New
  metered-use constant `JANITOR_CLEANS=3` (wired in `init.ts` + harness). A clean
  "applies" ONLY when the MAFIA faction kill lands on the marked seat; then the
  public `death_announce` is emitted with `cleaned:true` and NO `role`/`lastWill`,
  the seat is left `revealed=false` (its alignment stays secret until game over),
  and the janitor privately learns the scrubbed role + will. A use is consumed
  ONLY when a clean lands. To support this, `death_announce.role` became OPTIONAL
  and gained a `cleaned?:boolean` flag. Both leak auditors were updated: a
  `cleaned` death_announce does NOT mark the seat revealed (so a later leak of its
  true role is still caught), and `janitor_result` is whitelisted as a legitimate
  per-seat role carrier. The client `DeathFeed` renders cleaned bodies with a
  "scene wiped clean" line (no faction/will); `PrivateLog` renders the janitor's
  private result. Sheriff not-suspicious; investigator class R5
  (Escort/Consort/Janitor). NOT added to `RANDOM_MAFIA_POOL` (metered/special —
  fixed-slot only); exercised via the `smoke-and-mirrors` showcase setup.

- **[batch A · Bodyguard] Town protective trade (UNLIMITED — simpler classic
  rule).** New `NightAbility` `guard` (visits the ward); new trace
  `{ step:'guard', bodyguard, ward, attacker, killedAttacker }`; new `DeathCause`
  `bodyguard`. Chose the UNLIMITED classic rule (no metered uses) over a one-shot
  vest. Resolution: a guarding bodyguard intercepts a BASIC attack
  (`mafia`/`vigilante`/`serial_killer`) on its ward — inserted between the
  night-immune check and the doctor-shield check, so it takes priority over the
  Doctor but never fires on an immune ward. On interception the ward survives
  (treated as healed), the bodyguard dies in their place (death cause = the
  incoming attack), and a counterattack is queued. Counterattacks resolve in a
  fixed second pass: a basic attack that kills the assailant UNLESS they are
  night-immune (Godfather / Serial Killer survive but the trade still costs the
  bodyguard and saves the ward). Decisions recorded: the bodyguard ALWAYS dies on
  a trade (no doctor can save them); the counterattack is point-blank (NOT stopped
  by the assailant's doctor); multiple bodyguards on one ward each intercept one
  attack, lowest-seat first; `bodyguard` slots into `KILL_SOURCE_ORDER` just after
  `jailor_execute`. Sheriff not-suspicious; investigator class R7
  (Godfather/Mayor/Bodyguard). Town role — not in any random pool; in the
  `smoke-and-mirrors` setup.

- **[batch A · Blackmailer] Mafia day-chat silence.** New `NightAbility`
  `blackmail` (visits); new trace `{ step:'blackmail', blackmailer, target }`; new
  `private_result` kind `blackmailed` (static text). New per-seat state
  `silencedForNight: number` (init -1), set to the current `nightNumber` when
  blackmailed. Enforced in `apply.ts` `handleChat` on the `day` channel: a message
  is dropped while `s.silencedForNight === state.nightNumber`. Because
  `nightNumber` only increments when the NEXT NIGHT begins, the silence naturally
  covers exactly the day phases following the blackmail night and expires after.
  The target gets a private `blackmailed` notice (addressed to them only). Sheriff
  reads it suspicious (added to the engine's `sheriffRead` list + the spec test);
  investigator class R2 (Sheriff/Jailor/Blackmailer). Added to `RANDOM_MAFIA_POOL`;
  exercised by the `smoke-and-mirrors` RANDOM_MAFIA slot and Classic 12p+.

- **[batch A · Veteran] Town alert (killing, 3 alerts).** New `NightAbility`
  `alert` (self-only toggle, null target — `handleNightAction` and both bot
  policies treat `alert` like `vest`); new trace `{ step:'alert', veteran,
  visitors }`; new `DeathCause` `veteran`; new constant `VETERAN_ALERTS=3` (wired
  in `init.ts` + harness). On an alert night the Veteran is night-immune AND
  roleblock-immune (added to the step-2 `immune` set and the kill-loop immune
  check) and kills EVERY seat that VISITS them — visitors computed from
  post-block/post-redirect intents via the existing `actorVisits` (so a blocked
  visitor or a non-visiting actor does not count). The counters are basic attacks
  (added as `veteran`-source kills) — a night-immune visitor (Godfather / Serial
  Killer) survives but the alert still fired. A jailed Veteran cannot alert (its
  intent + alert flag are dropped at the jail step, so no use is burned). The
  alert use is consumed in `applyUseDecrements` only when the Veteran actually
  alerted. `veteran` slots into `KILL_SOURCE_ORDER` after `bodyguard` and is a
  `BASIC_ATTACK_SOURCE` (so a Bodyguard guarding a visitor could intercept it).
  Sheriff not-suspicious; investigator class R6 (Vigilante/Mafioso/Veteran). Town
  role — in the `smoke-and-mirrors` setup. Determinism + termination + leak sweeps
  all stayed green (the trickiest role; visit-set ordering is fully sorted).

### Batch A — cross-cutting changes & gate

- `death_announce.role` became OPTIONAL with a `cleaned?:boolean` flag (Janitor).
- New private-result kinds: `consigliere_result`, `janitor_result` (role
  carriers, whitelisted in both leak auditors), `blackmailed` (static text).
- New death causes: `bodyguard`, `veteran` (both exhaustive switches updated:
  `strings.ts deathLine`, client `anim.ts effectForCause`, `DEATH_CAUSE_LABEL`).
- New seat state: `silencedForNight` (Blackmailer). New constants `JANITOR_CLEANS`,
  `VETERAN_ALERTS`.
- Every new RoleId added to: `role.ts ROLE_IDS`, `roles/index.ts`
  (ROLES + export + investigator class), `bots/leak.ts KNOWN_ROLES`, the engine
  test harness `FACTION_OF` (+ `USES` for metered roles). Role display names come
  from shared `ROLES[id].name` (client reads via `getRole`), so no separate client
  role-name map needed; `strings-extra.ts` got the new trace/death-cause labels.
- New curated setup `smoke-and-mirrors` is the batch-A leak-sweep target (added to
  the leakcheck `SETUP_MAP`). Final gate: `pnpm -r build` green, `pnpm -r test`
  426 tests green, `npx eslint .` clean, leakcheck 0 leaks/200 (classic 9p) and
  0/200 (classic 12p) and 0/60 (smoke-and-mirrors 15p); engine sims 100% complete.

---

## Role expansion batch B (Tracker, Spy, Amnesiac, Medium, Disguiser, Arsonist)

A second roster expansion mirroring batch A's end-to-end wiring. Determinism +
the §5 information-leak invariant held throughout; every new RoleId is in the
leak auditor's `KNOWN_ROLES` and every new role-carrying private_result kind is
whitelisted in BOTH leak auditors (engine `test/leak.test.ts` allowlist and
`bots/leak.ts mentionsRoleForOtherSeat`). Original noir copy for all role text.
No win-condition / faction logic changed: new roles reuse existing factions
(`TOWN`, `MAFIA`, `NEUTRAL_BENIGN`, `NEUTRAL_KILLING`).

### Tracker (Town, info) — `investigate_track` / trace `kind:'track'`
- Watches one player and learns who THAT player VISITED (inverse of Lookout).
  Reuses the same `actorVisits`-derived visit set resolve.ts computes for the
  Lookout, but indexed by ACTOR (visitor→target) rather than target→visitors.
- Result delivered privately as `tracker_result {target, visited: SeatId[]}` —
  a LIST OF SEATS (not roles), so it is leak-trivial (no role string). The
  tracked seat's mafia-kill visit is attributed to the kill performer exactly
  like the Lookout's view (consistency). A tracker watching a non-visiting seat
  (control/jail/vest/alert/no action) gets an empty list.
- Investigator class R2 (with Sheriff/Jailor/Blackmailer); sheriff = not_susp.

### Spy (Town, info) — `spy` (self, no target) / trace `kind:'spy'`
- Learns the SET OF SEATS the MAFIA visited that night. SCOPE DECISION: to stay
  leak-simple we deliver ONLY the seats targeted/visited by mafia actors (the
  classic "the mafia visited these seats" bug), NOT mafia identities and NOT
  mafia chat. "Mafia visited" = the set of targets of living MAFIA-faction
  actors whose ability `actorVisits` (so the kill performer's victim, a
  framer's mark, a consigliere's mark, a janitor's mark, a blackmailer's
  target; Godfather control does NOT visit, mirroring the Lookout view). A
  self-target is not a visit. Result `spy_result {seats: SeatId[]}` carries
  only seat ids — no roles — so it is leak-trivial.
- Self-only ability (no target), like `vest`/`alert`: `handleNightAction`
  treats a null target as a valid Spy submission (added to the allowlist).
- Investigator class R3; sheriff = not_susp.

### Amnesiac (Neutral Benign, faction NEUTRAL_BENIGN) — `remember` / promotion `kind:'amnesiac_remember'`
- At night may target a DEAD player and "remember" their role; on resolution the
  Amnesiac BECOMES that role (role + faction change), mirroring the existing
  Executioner→Jester promotion in resolve.ts (a new `promotion` trace variant
  `amnesiac_remember {seat, newRole}`, applied inside resolveNight's promotions
  block). Until they convert they are a benign that wins by surviving — handled
  by the Survivor-style benign rider in wincheck.ts `buildGameOver` (the
  Amnesiac is added to the "alive benign wins" rider alongside Survivor).
- EXCLUSION LIST (spec-silent, recorded): cannot remember a UNIQUE role that is
  still held by a LIVING seat (Jailor/Mayor/Godfather/Serial Killer), and cannot
  become AMNESIAC/JESTER/EXECUTIONER (the benign "win by a trick" roles) — those
  would be degenerate. May remember any other dead seat's role (incl. non-unique
  mafia/town/SK). On becoming a MAFIA role the faction flips to MAFIA and the
  mafia roster is refreshed; on becoming SERIAL_KILLER → NEUTRAL_KILLING. The
  remembered role's metered uses are granted via the same `initialUses` table.
- A private `remember_result {target, role}` notice (role carrier, whitelisted)
  confirms what they became, addressed only to the amnesiac. Investigator class
  R1 (with Citizen/Survivor/Executioner — the "harmless-looking" class);
  sheriff = not_susp.

### Medium (Town, support) — séance: `dead` chat entitlement extended
- VARIANT CHOSEN: the simpler, leak-green classic variant. The Medium, while
  ALIVE, may once per game open a ONE-NIGHT séance: during that NIGHT the Medium
  is granted the DEAD chat entitlement (read+write) so they converse with the
  dead, WITHOUT revealing the Medium's role to the dead (the dead see the
  Medium's SEAT only, exactly as dead seats already see each other's seats — no
  role string is ever sent). The two-way séance reuses the existing `dead` chat
  plumbing in `handleChat`: a seat is dead-chat-entitled iff `!alive` OR
  (alive Medium with an active séance this night). This adds NO new message
  type and NO role string to any frame, so the leak auditor is unaffected.
  RATIONALE for not doing a brand-new masked channel: the spec explicitly
  permits the simpler variant if a new entitlement risks the auditor; the dead
  channel already masks nothing but seats (never roles), so extending its
  membership by one living seat for one night cannot leak a role.
- A `seance` day-or-night ability toggles the séance for the COMING night
  (selected during the day like the Jailor, stored in `GameState.seanceMedium`
  + the medium's `usesRemaining` is decremented when the séance night resolves).
  SECURITY: living NON-medium seats never gain dead-chat; the séance only ever
  ADDS the one medium seat to the dead audience for that night, and the medium's
  own messages are addressed to `dead` (the dead) — never to the living.
  Investigator class R4 (with Doctor/SK); sheriff = not_susp.

### Disguiser (Mafia, deception) — `disguise` / trace `kind:'disguise'`
- At night targets a DEAD player; takes on that player's ROLE APPEARANCE. Stored
  as `SeatState.apparentRole: RoleId | null` (an overlay; the TRUE `role`/
  `faction`/win are unchanged). SURFACES that use apparentRole (recorded): (1)
  Sheriff read — uses apparentRole's sheriffResult; (2) Investigator read — uses
  apparentRole's investigator class; (3) Consigliere read — returns apparentRole;
  (4) the Disguiser's own DEATH REVEAL (public death_announce + the death trace's
  role) shows apparentRole. Framing still overrides investigations (framed wins).
  Lookout/Tracker/Spy are UNAFFECTED (they report seats, not roles). The overlay
  persists until the Disguiser re-disguises or dies (set once, sticky) — recorded.
- No new private_result (the Disguiser learns nothing). Investigator class R8
  (with Framer/Lookout/Forger). Sheriff = suspicious (a mafia deceiver), but note
  the apparentRole overlay means a Sheriff checking a disguised Disguiser sees the
  DISGUISE's alignment, not "suspicious".

### Arsonist (Neutral Killing, faction NEUTRAL_KILLING) — `douse` / `ignite`
- Reuses the existing SK/last-killer win path (NEUTRAL_KILLING) — NO new win
  logic; wincheck.ts treats NEUTRAL_KILLING uniformly (the existing `t.sk`
  bucket is "all NEUTRAL_KILLING seats", so an Arsonist already counts toward
  the serial_killer win family). DECISION: rename nothing; the existing
  `serial_killer_last` / 1v1 SK rules now also cover a lone Arsonist.
- Two abilities on ONE night ability key family: `douse` (mark a target —
  `SeatState.doused=true`, no kill) and `ignite` (self-target, like vest/alert/
  spy: kills ALL currently-doused living seats at once). Ignite is a POWERFUL
  attack: it pierces basic defense (doctor heal + bodyguard + vest do NOT save a
  doused victim; only jail and night-immunity stop it) — modeled as a new
  DeathCause `arsonist` added to `BASIC_ATTACK_SOURCES`? NO: arson is NOT basic
  (bodyguard does not intercept it); it is added to the kill pipeline as a
  piercing source like jailor_execute but RESPECTING night-immunity and jail.
  Implemented via a dedicated branch (doused victims die unless jailed/immune).
- The Arsonist is NIGHT-IMMUNE (like the SK) and roleblock-interaction: a doused
  flag persists until ignite or the arsonist dies (recorded simplification — no
  cleaning/un-dousing). On ignite the arsonist's own douse marks are cleared.
  Igniting consumes nothing metered (unlimited, like the SK kill). Douse visits
  the target (Lookout/Tracker see it); ignite does not visit anyone.
  Investigator class R4? It would overload R4 (Doctor/SK). DECISION: Arsonist →
  R4 alongside SK/Doctor is thematically the "killer" class but the spec's class
  table is implementer-chosen here; to keep each class balanced we place
  Arsonist in R7 (with Godfather/Mayor/Bodyguard). Sheriff = suspicious.
  No new private_result (ignite/douse produce a standard `was_attacked` only via
  the normal kill pipeline for survivors; doused seats are NOT notified — a
  doused player does not know, by classic design — recorded).

### Setups
- All six new roles are added to the `smoke-and-mirrors` showcase setup so they
  are drawable, plus the random pools: Tracker/Spy/Medium join the curated
  `townPool`s and Disguiser joins `RANDOM_MAFIA_POOL`. Amnesiac/Arsonist are
  neutrals placed as fixed slots in the showcase (neutrals are never in the
  RANDOM_TOWN/RANDOM_MAFIA category pools). The batch-B leak sweep target stays
  `smoke-and-mirrors` at >=120 games / 15 players.

---

## Role expansion batch C (Crusader, Ambusher, Trapper, Psychic, Hypnotist)

Fifth/sixth role wave (mirrors batches A/B exactly — determinism + the §5
information-leak invariant held throughout; every new RoleId added to the leak
auditor's KNOWN_ROLES; new role-carrying private_results whitelisted). All copy
is ORIGINAL noir; all names are generic/real-world (no coined source names).

These roles REUSE the existing factions + win conditions — no `wincheck.ts`
faction-logic change, no new faction.

### Crusader (Town, faction TOWN) — `crusade`
- Mirrors the Bodyguard wiring (protective/killing). Guards a ward; the ward is
  protected from ONE basic attack (like a doctor shield), AND the Crusader kills
  ONE visitor to the ward that night. The killed visitor is the LOWEST-seat
  visitor, excluding the ward itself, the Crusader, and any non-visiting/astral
  actor (reuses the same `actorVisits` visit set the Lookout/Veteran use).
- New TOWN-aligned death cause `crusader`. It is a BASIC attack (added to
  `BASIC_ATTACK_SOURCES` so a Bodyguard could intercept it, and so it is stopped
  by night-immunity / vest) — a holy strike, but not piercing.
- DECISION — how Crusader differs from Bodyguard: the Bodyguard trades its OWN
  life for the ward and counterattacks the specific assailant; the Crusader does
  NOT die and strikes the lowest-seat VISITOR (which may be an innocent visitor,
  the classic Crusader hazard). The ward protection is a one-attack shield like
  a doctor's, not a body-swap.
- Uses: UNLIMITED (classic Crusader guards every night). Investigator class R6
  (with Vigilante/Mafioso/Veteran — the town "striker" class). Sheriff = not
  suspicious. Visits the ward (Lookout sees the Crusader).

### Ambusher (Mafia, faction MAFIA) — `ambush`
- Mafia mirror of the Crusader's kill. Lies in wait at a target location and
  kills ONE visitor to that target (lowest-seat visitor, excluding the Ambusher
  itself; the target/ward is NOT excluded here — anyone who visits the watched
  house is fair game, classic Ambusher). Death cause `ambush` (Mafia-aligned,
  BASIC attack). The Ambusher VISITS the location (Lookout sees them at the
  watched house — classic tell).
- Uses: UNLIMITED. Investigator class R8 (with Framer/Lookout/Forger/Disguiser).
  Sheriff = suspicious (a mafia killer). No new private_result (the kill surfaces
  via the normal dawn death announce + the standard attacker notices).

### Trapper — SKIPPED (overlaps Crusader)
- A Trapper that "kills the lowest-seat hostile visitor to the trapped player"
  is mechanically the Crusader minus the ward-shield (or the Crusader minus the
  innocent-visitor hazard if it only hits HOSTILE visitors). Distinguishing it
  safely (a multi-night "build" timer, or a hostile-only filter that must read
  factions of visitors without leaking) adds determinism/leak surface for little
  design payoff and risks the gate. Per the prompt's explicit allowance, SKIPPED
  to keep the tree green and the roster distinct.

### Psychic (Town, faction TOWN) — `divine` (self-only, no target)
- Each night the Psychic receives a VISION: a set of living seats among which at
  least one is evil (odd nights) or at least one is good (even nights), drawn
  deterministically from the seeded PRNG. Implementation: pick a guaranteed
  anchor seat of the required alignment (evil = MAFIA ∪ NEUTRAL_KILLING; good =
  TOWN ∪ NEUTRAL_BENIGN) using the engine PRNG, then fill the vision with
  PRNG-shuffled other living seats up to a fixed size (3 on a full board, fewer
  near the endgame), then sort the seats so the payload reveals NOTHING about
  which seat is the anchor. The vision NEVER carries roles or factions — only a
  sorted seat list — so it needs no leak whitelist.
- New private_result `psychic_vision` (carries `seats: SeatId[]` and the `parity`
  ('evil'|'good') so the client can word it). The leak test asserts no role
  string ever appears in a psychic_vision frame.
- Self-only ability (no street visit — the Psychic stays home). Investigator
  class R3 (with Investigator/Jester/Consigliere/Spy). Sheriff = not suspicious.
  Unlimited.

### Hypnotist (Mafia, faction MAFIA) — `hypnotize`
- Plants a FALSE night feedback in the target: the target receives a fabricated
  private_result that did not actually happen. To add NO new leakable surface,
  the Hypnotist REUSES existing private_result kinds that carry no secrets —
  specifically it can send a fake `roleblocked` ("you were distracted") or a fake
  `was_attacked` ("a blade came for you and missed"). DECISION: the fake message
  is fixed/deterministic per night — it sends `roleblocked` (the most common
  benign feedback) so the target wastes a day chasing a phantom roleblocker.
  These kinds carry only the bare kind (no seats, no roles), so they reveal no
  real secret and add no leak surface.
- The Hypnotist's plant has NO real mechanical effect (the target's action still
  resolves normally). Visits the target (Lookout sees the Hypnotist). Investigator
  class R5 (with Escort/Consort/Janitor — the mafia "support" class). Sheriff =
  suspicious. Unlimited. No new private_result kind, no new death cause.

### Setups / pools
- Crusader + Psychic (Town) join the `smoke-and-mirrors` curated `townPool` and
  one is added as a fixed showcase slot. Ambusher + Hypnotist (Mafia) join
  `RANDOM_MAFIA_POOL`. Trapper not shipped. The classic-9p leak gate is unchanged
  (classic uses none of these); the 15p smoke-and-mirrors sweep (orchestrator-run)
  exercises them.

---

## Role expansion batch D (Werewolf, Mass Murderer, Guardian Angel, Juggernaut)

Fourth/seventh role wave — iconic NEUTRAL roles (37 total). Determinism + the §5
information-leak invariant held throughout; every new RoleId added to the leak
auditor's KNOWN_ROLES. All copy is ORIGINAL noir; all names are generic/real-world.

These roles REUSE existing win machinery. The three lone killers are
NEUTRAL_KILLING, so they fall into the existing `t.sk` tally in `wincheck.ts` and
win via the unchanged `serial_killer_last` / `one_v_one` / stalemate paths exactly
like the SK and the Arsonist — NO faction-logic change for them. The only
`wincheck.ts` change is the Guardian Angel personal-win rider (below).

### Werewolf (Neutral Killing, faction NEUTRAL_KILLING) — `rampage`
- Full-moon rule (recorded): a FULL MOON is deterministically every EVEN-numbered
  night (`state.nightNumber % 2 === 0`). Night 1 is odd ⇒ no full moon (no kill on
  N1, classic); night 2 is the first full moon. `isFullMoon(state)` in resolve.ts.
- On a full-moon night the Werewolf RAMPAGES: kills its chosen target AND every
  seat that VISITED the Werewolf that night (keyed off visitors to ITSELF, via the
  new `visitorsTo` helper over the same post-block `actorVisits` set the Lookout/
  Veteran use). A self-target means "stay home and only maul visitors". Victims are
  sorted and de-duped; all pushed as `werewolf` kills.
- On a NON-full-moon night the beast SLEEPS (the simpler classic rule, recorded):
  the `rampage` intent is DROPPED at the top of resolution so the Werewolf neither
  kills NOR visits (a Lookout on the Werewolf sees nothing). A `rampage` trace with
  `fullMoon:false, victims:[]` is still recorded.
- New death cause `werewolf` — a POWERFUL attack (pierces doctor heal / bodyguard /
  vest) but stopped by jail and night-immunity. Implemented via a generalized
  `isPowerfulAttack(k)` in the kill pass (replacing the old arsonist-only branch),
  with `KillIntent.powerful` carrying the flag. Night-immune like the SK; sheriff =
  suspicious; investigator class R6 (with Vigilante/Mafioso/Veteran/Crusader/
  Juggernaut). UNIQUE (one per setup, like the SK/Arsonist). No new private result
  (kills surface via the normal dawn death_announce).

### Mass Murderer (Neutral Killing, faction NEUTRAL_KILLING) — `massacre`
- Distinct from the Werewolf: keys off a CHOSEN HOUSE, not visitors-to-self. Visits
  the target's house and kills the RESIDENT plus every OTHER visitor to that house
  (again via `visitorsTo`, excluding the murderer + the house from the visitor set,
  but the resident itself is a victim). New death cause `massacre`, also POWERFUL
  (pierces basic defense; stopped by jail/immunity). Visits the house (Lookout sees
  it). Night-immune; sheriff = suspicious; investigator class R4 (with Doctor/SK/
  Medium). UNIQUE. No new private result.
- NOT skipped: it is mechanically distinct from the Werewolf (chosen-house slaughter
  vs. visitors-to-self rampage on full moons only) and from the Ambusher (which kills
  only the LOWEST-seat visitor and not the resident; the MM kills ALL of them + the
  resident, every night). Recorded as safely distinct.

### Guardian Angel (Neutral Benign, faction NEUTRAL_BENIGN) — `shield`
- Init target (mirrors the Executioner's assignment, init.ts): one random NON-EVIL,
  non-self charge that is not another Guardian Angel. "Non-evil" excludes MAFIA and
  NEUTRAL_KILLING (you cannot be tied to protect a killer); Town and other benigns
  are valid charges (recorded rule). If no valid charge exists, the GA becomes a
  SURVIVOR immediately at init (uses re-rolled to a Survivor's vests).
- Each night the GA may shield ONLY its assigned charge from one attack — exactly
  like a doctor heal (reuses the `doctorShield` map / step 3; lowest-seat protector
  wins ties; a revealed Mayor can't be healed). The engine enforces the charge link
  (`self.gaTarget === i.target`); an illegal target is a no-op. New `shield` trace.
  Visits the charge (visits:true). Sheriff = not suspicious; investigator class R1
  (with Citizen/Survivor/Executioner/Amnesiac). Not unique. No new private result
  (the shield surfaces as the charge's existing `was_healed`/`was_attacked`).
- If the charge DIES, the GA's purpose is spent: it CONVERTS to a Survivor (the
  simpler classic rule, recorded) in step 8 — role→SURVIVOR, faction stays
  NEUTRAL_BENIGN, `gaTarget` cleared, uses → Survivor vests, new `promotion`/
  `guardian_to_survivor` trace. It then rides the SURVIVOR win if alive at the end.
- PERSONAL WIN (the one wincheck.ts change — minimal + additive):
  * New `WinningParty` value `'GUARDIAN_ANGEL'` (packages/shared/src/types/outcome.ts
    `WINNING_PARTIES`, before `'DRAW'`).
  * New `state.gaWinners: SeatId[]` field (state.ts + init `gaWinners: []`),
    mirroring `jesterWinners`/`exeWinners`.
  * Rider logic in `buildGameOver`: populate `state.gaWinners` from the FINAL state
    — any seat still `role === 'GUARDIAN_ANGEL'` whose `gaTarget` charge is ALIVE
    wins; if non-empty, `winners.add('GUARDIAN_ANGEL')`. (A GA whose charge died is
    already a Survivor by then, so it never appears here; it rides SURVIVOR
    instead.) `seatWon` gains `if (state.gaWinners.includes(seat.seat)) return true;`.
    Computed at game over rather than at a lynch (unlike jester/exe) because the win
    depends on the live end-state, but kept as a state field to mirror the pattern
    and surface in replays.
  * Client exhaustive switch updated: `WINNER_LABEL['GUARDIAN_ANGEL']` in
    strings-extra.ts. The win-condition golden tests (win.test.ts) and a new
    `buildGameOver` GA golden in roles-batch-d.test.ts pass.

### Juggernaut (Neutral Killing, faction NEUTRAL_KILLING) — `juggernaut`
- SHIPPED (stayed green). Per-seat kill counter `SeatState.killCount` (state.ts;
  init 0). Escalation, all deterministic:
  * Gate: locked to FULL-MOON nights until its first kill is on the board; once
    `killCount > 0` it may strike on ANY night.
  * Power: once `killCount >= JUGGERNAUT_POWER_THRESHOLD` (=2) its attack becomes
    POWERFUL (pierces basic defense via `KillIntent.powerful: true`) AND mauls every
    other visitor to the victim's house (rampage via `visitorsTo`). Below the
    threshold it is a BASIC attack (`juggernaut` is in BASIC_ATTACK_SOURCES) that a
    doctor/bodyguard/vest can stop — the powerful branch runs first in the kill pass,
    so a powered-up kill pierces before interception is considered.
  * Counter increment in step 8: `killCount += (# seats that died THIS night with
    the juggernaut cause)`. Deterministic; the unique Juggernaut owns all such
    deaths. New death cause `juggernaut`; new `juggernaut` trace (with `powerful`).
- Night-immune; sheriff = suspicious; investigator class R6; UNIQUE. No new private
  result.

### Engine state / abilities / traces / causes (batch D)
- SeatState: `gaTarget: SeatId | null`, `killCount: number`. GameState:
  `gaWinners: SeatId[]`. (harness.ts makeGame + leak/property paths updated; the
  harness also now sets the previously-missing `stumped: false`.)
- NightAbility: `rampage`, `massacre`, `shield`, `juggernaut` (+ roleinfo.ts
  roleToNightAbility / ability cards Rampage / Massacre / "Watch over" / Crush; all
  four added to `actorVisits` true-group).
- ResolutionTrace: `rampage`, `massacre`, `shield`, `juggernaut`, and a
  `promotion`/`guardian_to_survivor` variant.
- DeathCause: `werewolf`, `massacre`, `juggernaut` (shared death.ts + deathLine
  strings + client DEATH_CAUSE_LABEL + anim.ts effectForCause → 'knife' for all
  three + TRACE_STEP_LABEL entries). `KILL_SOURCE_ORDER` extended (werewolf/massacre/
  juggernaut between serial_killer and arsonist). `BASIC_ATTACK_SOURCES` gains
  `juggernaut`; `isPowerfulAttack` returns true for werewolf/massacre/arsonist and a
  flagged juggernaut. `isNightImmune` + the resolve.ts sheriff-suspicious list gain
  WEREWOLF/MASS_MURDERER/JUGGERNAUT.

### Leak / strings / enum
- leak.ts KNOWN_ROLES (bots) + the engine deep-scan KNOWN_ROLES inherit the four new
  ids. NO new role-carrying private_result was introduced (GA reuses the doctor
  shield → existing `was_healed`/`was_attacked`; the killers surface via the legal
  death_announce), so NO new leak whitelist was needed in either auditor.
- Shared strings.ts: deathLine cases for werewolf/massacre/juggernaut. Role display
  via the standard ROLES registry (name/tagline/description/winHint). Client
  strings-extra.ts: DEATH_CAUSE_LABEL, WINNER_LABEL['GUARDIAN_ANGEL'],
  TRACE_STEP_LABEL.

### Setups
- New curated 15p showcase `full-moon` (curated.ts + setups/index.ts SETUPS, +
  leakcheck.ts SETUP_MAP) fields all four batch-D roles as fixed neutral slots
  (Werewolf, Mass Murderer, Juggernaut, Guardian Angel) against a protective-heavy
  Town and a 3-Mafia core (one RANDOM_MAFIA). The batch-D roles are neutral, so they
  are NOT added to the RANDOM_TOWN/RANDOM_MAFIA category pools (neutrals are never in
  those pools, consistent with prior batches). The classic-9p gate is unchanged.

### Gate (batch D)
- `pnpm -r build` green (incl. client; the exhaustive WinningParty/DeathCause
  switches compile). `pnpm -r test`: 481 tests pass (shared 176, engine 125 [+18
  batch-D goldens incl. Werewolf full-moon timing, MM massacre, GA shield + personal
  win + Survivor conversion, Juggernaut gate/escalation/pierce], client 91, server
  56, bots 33). `npx eslint .` clean. Classic-9p leak gate: 0 leaks / 200 games.
  Targeted `full-moon` 15p sweep: 0 leaks / 80 games, 80/80 completed (determinism +
  termination hold). The slow 15p smoke sweep is the orchestrator's job.

### Skipped
- Nothing skipped. All four roles (including the Juggernaut, which the spec marked
  optional) shipped green.

---

## Triad faction (second evil killing faction)

A full mirror of the Mafia faction: its own informed minority, private night chat,
faction kill, faction roster, succession, and parity win. The two evil factions are
ENEMIES (not allies) — they cannot co-win and must wipe each other out first.

### Enum / type additions
- **Faction**: added `TRIAD` (shared `faction.ts`). Updated every exhaustive
  switch/Record over Faction across shared/engine/server/client (compose
  `slotFaction`/`factionCounts`, validate `CATEGORY_FACTION`, wincheck tally +
  `seatWon`, client `FACTION_LABEL`/`ROLES_BY_FACTION`/faction tally/`FactionIcon`/
  `.faction-TRIAD`).
- **ChatChannel**: added `'triad'` (shared `chat.ts`), mirroring `'mafia'`.
- **EffectTarget**: added `'triad'` (shared `effect.ts`) → transport `triadSeats()`
  routing; the `toTriad` engine effect helper. (Engine `apply.ts` triad chat is
  addressed via explicit `toSeats(livingTriad)` like the mafia chat, which already
  guarantees the audience; the `'triad'` target + `toTriad` helper are provided per
  spec for parity and future faction-broadcast use.)
- **WinningParty**: added `TRIAD` (shared `outcome.ts`) + client `WINNER_LABEL`.
- **DeathCause**: added `triad` (a BASIC attack, identical to `mafia`: stopped by
  Doctor/Bodyguard/vest/jail/night-immunity). Wired into `KILL_SOURCE_ORDER`
  (right after `mafia`), `BASIC_ATTACK_SOURCES`, death-note attribution
  (`killerOf`), client `DEATH_CAUSE_LABEL` + `effectForCause` ('knife'), shared
  `deathLine`.
- **NightAbility**: `kill_triad` (Enforcer performs) + `triad_control` (Dragon Head
  orders), mirrors `kill_mafia`/`mafia_control`. `actorVisits`: triad_control does
  NOT visit, kill_triad DOES.
- **ResolutionTrace**: `promotion`/`triad_succession` variant. **WinCheckReason**:
  `triad_parity`. **GameState**: `triadSeats: SeatId[]` (mirrors `mafiaSeats`),
  maintained at init, in resolve.ts roster refresh, and on admin kill/stump.

### Triad roles (generic names; faction TRIAD)
- **DRAGON_HEAD** ≈ Godfather: unique, night-immune, roleblock-immune, sheriff
  reads not_suspicious, investigator R7, `triad_control` (no visit unless it must
  personally kill). 
- **ENFORCER** ≈ Mafioso: not unique, sheriff suspicious, investigator R6,
  blockable, `kill_triad`. Succession target.
- **VANGUARD** ≈ Consort (DECISION: the Triad support is a ROLEBLOCKER, not a
  framer — chosen because the roleblock mechanic is the cleanest standalone mirror
  and the Triad already has its kill/deception covered by the core). Sheriff
  suspicious, investigator R5, `roleblock`.
- Added to `INVESTIGATOR_CLASS_TABLE` (R5/R6/R7), the resolve.ts sheriff-suspicious
  list (ENFORCER, VANGUARD; DRAGON_HEAD reads clean), `isNightImmune` /
  `isRoleblockImmune` (DRAGON_HEAD), Psychic evil factions (TRIAD).
- **RANDOM_TRIAD** category (shared `setup.ts` SLOT_CATEGORIES) + `RANDOM_TRIAD_POOL`
  (`['VANGUARD']`) mirroring RANDOM_MAFIA/RANDOM_MAFIA_POOL. DECISION: the Triad
  killing core (Dragon Head/Enforcer) is fixed-slotted like the Mafia core; the one
  flexible Triad support slot draws RANDOM_TRIAD.

### Win conditions — generalized to two evil killing factions (wincheck.ts)
The rule (rewritten, all old + new goldens green):
- **Town** wins iff NO living Mafia, NO living Triad, and NO living NK.
- **An evil killing faction F (Mafia or Triad)** wins iff F has living members,
  there are NO living members of the OTHER evil killing factions (the other of
  Mafia/Triad AND no living NK), and `|F| >= |living non-F|`. Two evil factions can
  NEVER co-win.
- **SK** wins iff last killer (no living Mafia, no living Triad), among only
  itself + benign.
- If two-or-more killing factions (Mafia/Triad/NK) are alive, the game CONTINUES.
- **1v1 auto-resolve** (DAY_VOTING start) priority ladder SK > evil faction > Town.
  Mafia-vs-Triad pure endgame (no Town/SK/benign): the LARGER faction wins; an
  exact tie CONTINUES (neither can out-kill without dying).
- **Stalemate guard** priority ladder: SK > Triad > Mafia > Town; larger count
  wins, ties broken by that priority.
- New goldens (engine `win.test.ts`, 24 total): triad-only parity; town-beats-triad
  (lone triad blocks town win); two-evil-factions continue; mafia-vs-triad one wins
  after the other is wiped; pure mafia-vs-triad larger-wins + tie-continues;
  SK-vs-triad 1v1; SK last-killer; stalemate triad-beats-mafia; game_over emits
  TRIAD. Plus `triad.test.ts` (10): kill lands/healed, Dragon-Head immunity, Vanguard
  roleblock, sheriff reads, succession, and the §5 triad-chat/roster entitlement.

### Leak auditor (bots/leak.ts + engine leak.test.ts)
- Added `observerIsTriad` (derived from the game_over true-faction reveal, exactly
  like `observerIsMafia`). A `'triad'` chat frame at a non-triad observer is a LEAK
  (mirror of the mafia-chat check). KNOWN_ROLES gains DRAGON_HEAD/ENFORCER/VANGUARD.
- `your_role.mates`: legitimate ONLY for an informed-evil owner of the SAME faction.
  STRENGTHENED the check — a Mafia roster naming a non-mafia seat, or a Triad roster
  naming a non-triad seat, is now flagged (cross-faction roster leak). The engine
  addresses mates `toSeat([owner])` from the owner's own faction, so this never
  fires in practice, but the auditor now has teeth for it. New `auditor.test.ts`
  cases prove: non-triad receiving triad chat = leak; cross-faction mates = leak; a
  legitimate triad seat receiving triad chat + triad mates = NOT a leak.

### Roster delivery
- `yourRoleEffect` (engine `roleinfo.ts`) + the fallback engine now deliver mates
  to a MAFIA seat (mafia roster) OR a TRIAD seat (triad roster) — each gets ONLY its
  own faction, addressed to the owning seat alone. Town/neutrals get no mates.

### Bots / client
- Bot policy (`policy.ts`): generalized the mafia-kill coordination to BOTH evil
  factions — `isMafiaKiller` recognizes kill_triad/triad_control; the leader
  proposes in the faction's OWN chat channel (`factionKillChannel()` → mafia|triad);
  mates/targets are faction-relative. `llm-policy.ts` picks mafia|triad chat by
  faction. `sim-engine.ts` `routeEffect` routes the `'triad'` target.
- Client: `--f-triad` jade-green color (+ teal colorblind variant), `.faction-TRIAD`,
  FACTION_LABEL/WINNER_LABEL/DEATH_CAUSE_LABEL entries, an original `IconTriad`
  glyph in `FactionIcon`, a `'triad'` chat tab (CHANNEL_LABEL `channelTriad` 'Triad';
  `lib/channels.ts` `isTriad` in entitledChannels/canSpeakIn; GameScreen computes
  `isTriad` and defaults the night tab to triad for a triad seat). DECISION: the
  Custom Setup Builder UI and lobby setup-preview keep their local
  RANDOM_TOWN|RANDOM_MAFIA dropdown union (no RANDOM_TRIAD option) — the Tong War
  curated setup uses FIXED Triad slots (+ one RANDOM_TRIAD), so the preview never
  meets a RANDOM_TRIAD slot; exposing RANDOM_TRIAD in the builder dropdown is a
  follow-up client-feature, not core to the faction.

### Setups
- New curated 15p **Tong War** (`tong-war`): Town(7: Jailor, Sheriff, Investigator,
  Doctor, Escort, Lookout, RANDOM_TOWN) + Mafia(3: GF, Mafioso, RANDOM_MAFIA) +
  Triad(3: Dragon Head, Enforcer, RANDOM_TRIAD→Vanguard) + Neutral(2: SK, Jester).
  Registered in setups/index SETUPS, leakcheck SETUP_MAP, sim normalizeSetup.
  `validateSetup` passes (auto-checked by validate.test over all SETUPS).

### Gate (Triad)
- `pnpm -r build` green (all exhaustive WinningParty/DeathCause/Faction/ChatChannel
  switches compile). `pnpm -r test`: 510 tests pass (shared 178, engine 149
  [+24 Triad goldens], client 91, server 56, bots 36 [+3 Triad auditor-teeth]).
  `npx eslint .` clean. Leak gate: classic-9p 0 leaks / 200 games (200/200); tong-war
  15p 0 leaks / 80 games (80/80) — the 'triad' chat + triad mates entitlement
  exercised and clean. FAST sim: tong-war 20/20 complete, sane winners (TRIAD 7,
  MAFIA 4, SERIAL_KILLER 5, +Jester riders — both evil factions win, none co-win);
  classic-9p 20/20 no regression. Determinism property tests green; tong-war
  fingerprints all distinct (20/20). Did NOT restart pm2 / deploy; did NOT commit.

### Skipped / deferred
- Janitor cleaning stays MAFIA-kill-only (the Janitor is a Mafia role; the Triad has
  no Janitor, so no triad-kill sanitization path is needed). The Spy's "mafia
  visited" vision stays mafia-scoped (the Spy is a Town role thematically tied to the
  Mafia; a triad-watching variant is out of scope). Exposing RANDOM_TRIAD in the
  Custom Setup Builder dropdown deferred (see Bots/client decision above).

---

## Role expansion batch E — complex neutrals / conversions

Five complex roles: **Witch** (neutral spoiler/control), **Pirate** (neutral
benign duel/plunder), **Plaguebearer → Pestilence** (NK conversion), and
**Retributionist** (Town resurrection). Four shipped, none skipped — all stay
determinism/leak/win-check green.

### Shared types / protocol
- `ROLE_IDS` += WITCH, PIRATE, PLAGUEBEARER, PESTILENCE, RETRIBUTIONIST. New role
  files + index.ts wiring + INVESTIGATOR_CLASS_TABLE (WITCH→R8, PIRATE→R6,
  PLAGUEBEARER/PESTILENCE→R4, RETRIBUTIONIST→R2). Each role's `investigatorClass`
  agrees with the table; roles.test.ts spec sets updated (unique, night-immune,
  roleblock-immune, sheriff-suspicious, invest table).
- `WINNING_PARTIES` += `WITCH` (spoiler rider) and `PIRATE` (personal rider).
- `DEATH_CAUSES` += `pestilence` (powerful NK attack); deathLine + DEATH_CAUSE_LABEL
  + anim effectForCause (poison) + KILL_SOURCE_ORDER entries added.
- `PRIVATE_RESULT_KINDS` += `controlled` (Witch). Carries NO controller identity,
  NO seats, NO roles — exactly as leak-trivial as `roleblocked`; needs NO whitelist
  in either leak auditor. PRIVATE_RESULT_TEXT noir line added.
- **Two-target night action**: added optional `target2` to the `night_action`
  protocol schema, the engine `NightActionEvent` + `NightIntent`, apply.ts
  handleNightAction (a `witch_control` missing either target is a no-op cancel),
  the server ws handler, the bots sim-engine event mapping, and client
  `sendNightAction`. DECISION: a full two-target client picker UI is a follow-up
  client feature; the engine/protocol/bots path is complete and exercised.
- Constants: RETRIBUTIONIST_REVIVES=1, PIRATE_PLUNDERS_TO_WIN=2.

### Engine state / abilities
- Seat fields: `infected` (Plaguebearer spread) + `plunderCount` (Pirate). GameState
  fields: `pirateWinners`, `witchWinners` (computed at game over, mirror gaWinners).
- NightAbility += witch_control, duel, infect, pestilence, retribute. ResolutionTrace
  += witch / duel / infect / retribute / promotion:plaguebearer_to_pestilence.
- roleinfo.ts: roleToNightAbility + abilityInfoFor for all five. resolve.ts gets a
  local `roleNightAbility(role)` (redirect-target mapper for the Witch).

### Witch (priority #1, NEUTRAL_BENIGN, control/spoiler)
- Runs in a NEW **Step 0.5** at the very TOP of resolveNight, BEFORE jail/roleblock/
  kills, so the redirected action flows through the rest of the pipeline normally.
  The puppet (`target`)'s intent target is overwritten to the victim (`target2`); if
  the puppet submitted nothing, an intent with its natural ability is CREATED. The
  puppet gets a `controlled` private_result (NO controller id). Control-immune (a
  Witch cannot be a puppet; another Witch is skipped, trace `redirected:false`),
  roleblock-immune + night-immune (added to isRoleblockImmune/isNightImmune). The
  Witch visits the puppet (actorVisits). Lowest-seat Witch wins a contested puppet.
- WIN: `witchWinners` rider in buildGameOver — a LIVING Witch wins iff the Town did
  NOT win (computed AFTER base winners, BEFORE the rider is added, so she never
  counts herself). seatWon recognizes the rider. Verified across 80 sim games: WITCH
  and TOWN NEVER co-win (0 violations); Witch rides MAFIA/SK/etc. ends.

### Pirate (NEUTRAL_BENIGN, duel/plunder)
- A `duel` adds a BlockIntent (occupies the target = roleblock) AND a `plundered`
  guard in the kill pass (target untouchable by every kill except a leaver suicide —
  same shape as jail). Outcome is the seeded PRNG vs a FIXED rock-paper-scissors
  rule: draw attack a∈{0,1,2} and defense d∈{0,1,2}; plunder SUCCEEDS iff
  (a-d+3)%3===1. A success credits `plunderCount`. WIN: `pirateWinners` rider —
  plunderCount ≥ 2 AND alive (personal, like the Executioner).

### Plaguebearer → Pestilence (NEUTRAL_KILLING conversion; reuses the NK win)
- Infection spread in step 8 over THIS night's visit graph (visitorsByTarget /
  visitedByActor): (1) the Plaguebearer infects everyone it visited + everyone who
  visited it; (2) a one-step outward creep from every already-infected carrier. A
  single bounded pass over a finite fixed graph — TERMINATES, deterministic. When
  ALL living seats are infected, role → PESTILENCE (faction stays NEUTRAL_KILLING →
  reuses the existing SK/last-killer win; NO new faction). Pestilence's `pestilence`
  kill is a powerful attack (pierces basic defense; stopped by jail/plunder +
  night-immunity). Verified: 11/60 sims reached the transform.

### Retributionist (TOWN resurrection) — SHIPPED (not skipped)
- Step-8 revive: once per game, a living Retributionist raises a DEAD **TOWN** seat
  (alive=true, deathCause/deathDay cleared, role/faction intact, one use spent).
  LEAK ANALYSIS: the revived seat's role was already publicly revealed at death
  (death_announce marked it revealed for every observer), so re-aliving leaks
  NOTHING new — we deliberately keep `revealed=true`. Only TOWN seats are revivable,
  so no faction-roster (mafia/triad mates) re-leak is possible. The leak auditor's
  per-observer `revealed` set already contains the seat, so a post-revive frame
  naming the role is legitimate. Confirmed: reckoning leak sweep 0 leaks; the revived
  seat is counted alive by the win check + rosters refresh.

### Setup
- New curated 15p **The Reckoning** (`reckoning`): Town(8: Jailor, Sheriff, Doctor,
  Lookout, Vigilante, Escort, Retributionist, Citizen) + Mafia(3: GF, Mafioso,
  RANDOM_MAFIA) + Neutral(4: Witch, Pirate, Plaguebearer, Serial Killer). PESTILENCE
  is a conversion-only role (never slotted). Registered in setups/index SETUPS,
  leakcheck SETUP_MAP. validateSetup passes. Bot policy now supplies a `target2` for
  a Witch's control so the two-target path is exercised in sims.

### Gate (batch E)
- `pnpm -r build` green (all exhaustive WinningParty/DeathCause/PrivateResultKind/
  Faction switches compile). `pnpm -r test`: 527 pass (shared 179, engine 165 [+16
  batch-E goldens: witch redirect/immunity/spoiler-win, pirate duel/plunder/win,
  plague spread→pestilence, pestilence powerful kill, retri revive/non-town/alive],
  client 91, server 56, bots 36). `npx eslint .` clean. Leak gate: classic-9p 0
  leaks/200 (200/200); reckoning-15p 0 leaks/60 (60/60, fresh seeds) — the Witch
  `controlled` result + the plaguebearer→pestilence conversion + retri revive all
  exercised and clean. Determinism: same seed → identical fingerprint across 20
  reckoning games (incl. the Pirate PRNG draws). Sim sanity (60 games): SK 39, WITCH
  34, MAFIA 9, PIRATE 4, TOWN 12; PESTILENCE transform in 11; PIRATE personal win in
  4; WITCH never co-wins with TOWN (0/80). Did NOT restart pm2 / deploy; did NOT commit.

### Skipped / deferred
- Nothing skipped. The Retributionist was the at-risk role (re-aliving a revealed
  seat) but is leak-safe (see analysis above) and shipped green. Deferred: a full
  two-target Witch picker in the human client UI (the engine/protocol/bots path is
  complete; `sendNightAction` accepts an optional `target2`).

---

## Vampire conversion faction (third evil killing faction)

The Vampire is Nocturne's first MID-GAME FACTION CHANGE faction: it grows by
CONVERSION (a night bite that turns a seat TOWN→VAMPIRE) rather than by a faction
kill. It mirrors the Mafia/Triad architecture where sensible, but is deliberately
KNOWLEDGE-ISOLATED to keep the information-leak invariant trivially provable.

### Leak-safety: knowledge-isolated (NO vampire chat, NO roster)
- Vampires share NO secret chat (no 'vampire' ChatChannel) and NO `your_role.mates`
  roster. Each vampire acts independently and is NEVER told who the others are. The
  ONLY private info a vampire receives is the `turned` private_result delivered to
  the converted seat alone, which carries NO other seat's identity or role (as
  leak-trivial as `roleblocked`/`controlled`).
- Rationale: the leak auditor derives true faction from the FINAL game_over reveal,
  so it cannot cheaply validate "this seat legitimately got vampire-secret info only
  AFTER it converted." By keeping the vampire info-surface empty (nothing secret
  crosses seats), the existing auditor needs only KNOWN_ROLES additions — no
  dynamic-faction-timeline rewrite. This is the recommended default; we took it.
- UPDATE (role-card resend, your_role-on-mutation): a converted seat IS now re-sent
  a fresh `your_role` at conversion so its UI rebuilds the card + abilities (e.g. the
  Bite action). This stays leak-safe because `yourRoleEffect` emits `mates` ONLY for
  the MAFIA/TRIAD factions — a VAMPIRE convert's resent frame carries the new role +
  abilities ONLY, NO roster, addressed to that seat alone. So: no roster, no chat,
  the new your_role carries no cross-seat secret ⇒ no new leak surface. Verified:
  0 leaks / 200 on classic 9p and 0 leaks across the-long-night / the-faithful /
  smoke-and-mirrors 15p sweeps (conversion + resend exercised).

### Conversion design
- WHO converts: only ONE vampire bites per night — the LOWEST-SEAT living vampire
  with a standing `bite` intent and a valid living target. Other vampires' bites are
  dropped (deterministic, bounded — avoids unbounded same-night chaos).
- WHAT is convertible: only a living TOWN or NEUTRAL_BENIGN seat that is NOT already
  a Vampire and NOT night-immune. Mafia/Triad/NK/other neutrals are non-convertible
  (the bite just fails) — avoids cross-faction-roster complications.
- IMMUNITY: vampires are NOT night-immune (classic) and NOT roleblock-immune. A
  jailed/roleblocked vampire's bite intent is dropped like any other.
- ROLE/FACTION CHANGE: a successful bite changes the target's role to VAMPIRE and
  faction to VAMPIRE (so investigations read consistently — a freshly-turned seat
  reads sheriff-suspicious / investigator-R4 / psychic-evil thereafter). Mirrors the
  executioner→jester / plaguebearer→pestilence / amnesiac-remember conversions.
- The bite is a VISIT (a Lookout/Tracker/Veteran/Crusader/Ambusher sees it). NO
  separate vampire kill — conversion + parity is the entire win condition.
- Resolution order: the stake (see below) is collected in the kill step; the
  conversion is applied in step 8 AFTER kills are settled, so a vampire killed this
  night (e.g. staked or shot) turns no one, and a target who dies this night is not
  turned. New ResolutionTrace `convert {vampire,target,converted,staked}`.

### Vampire Hunter (Town counter)
- PASSIVE STAKE: any vampire that bites the Hunter is killed on the spot (death
  cause `staked`, a powerful Town counter that pierces basic defense — a stake to
  the heart). Only a REACHABLE Hunter stakes (a jailed/dueled Hunter is locked away,
  so the bite simply fails). The stake routes through the normal kill pass.
- ACTIVE CHECK (classic-simpler variant chosen): each night the Hunter may study a
  target and learn vampire/not — a single boolean `vampire_hunter_result
  {target,isVampire}` (no role strings, leak-trivial like the sheriff read). It is
  NOT a kill (the only kill is the reactive stake). New trace `vampire_check`.
- RETIREMENT: once NO vampires remain in the game, every living Vampire Hunter
  becomes a VIGILANTE (role change within TOWN, mirroring exe→jester / GA→survivor),
  evaluated after the night's conversions/deaths so it never retires while a
  freshly-turned vampire still walks. New promotion trace `hunter_to_vigilante`.

### Win-check extension to THREE evil killing factions
wincheck.ts was generalized from the two-evil-faction (Mafia/Triad) form to a
uniform THREE-evil-faction form (Mafia, Triad, Vampire). The Vampire is just a third
killing faction that wins on parity; conversion is irrelevant to the math.
- Town wins iff no living Mafia, Triad, Vampire, OR NK.
- An evil faction F (Mafia|Triad|Vampire) wins iff F is the SOLE living killing
  faction (no other evil faction AND no SK) and F is at parity (|F| >= |living
  non-F|). Two+ killing factions alive ⇒ continue. Implemented via a uniform
  `livingEvil` list (length 1 ⇒ parity check) — no per-faction branch duplication.
- SK wins iff last killer (no living Mafia/Triad/Vampire), among only itself+benign.
- 1v1 DAY_VOTING auto-resolve + stalemate priority ladder: SK > Vampire > Triad >
  Mafia > Town. A pure evil-vs-evil endgame resolves to the strictly-larger faction;
  an exact top tie continues (auto-resolve) / draws-by-priority (stalemate). The
  two-faction Mafia-vs-Triad behavior is preserved exactly.
- New WinningParty VAMPIRE (shared outcome.ts) + WinCheckReason `vampire_parity`.
- ALL pre-existing win/triad/determinism goldens stay GREEN; added goldens: vampire
  parity, town beats vampires, vampire-vs-mafia continues, lone-vampire conversion to
  a parity win, town staking the coven out, stalemate Vampire>Triad tie, etc.

### Additions (surfaces touched)
- Faction VAMPIRE (FactionSchema; compose/validate/builder records; client
  FACTION_LABEL + `--f-vampire` desaturated crimson-violet [colorblind magenta] +
  .faction-VAMPIRE + IconVampire fangs glyph + FactionIcon case).
- WinningParty VAMPIRE + WINNER_LABEL line. WinCheckReason `vampire_parity`.
- RoleIds VAMPIRE (biter) + VAMPIRE_HUNTER (Town counter), with original noir copy.
  INVESTIGATOR_CLASS_TABLE: VAMPIRE→R4, VAMPIRE_HUNTER→R2. Sheriff: VAMPIRE
  suspicious, VAMPIRE_HUNTER clean. Psychic treats VAMPIRE as evil.
- NightAbility `bite` (VAMPIRE) + `vampire_check` (VAMPIRE_HUNTER); both visit.
  roleToNightAbility + abilityInfoFor (Bite / Hunt cards).
- DeathCause `staked`. PrivateResultKind `turned` + `vampire_hunter_result` (+ zod
  payloads, strings, client PrivateLog rendering). ResolutionTrace `convert`,
  `vampire_check`, promotion `hunter_to_vigilante`. KILL_SOURCE_ORDER `staked`.
- Curated setup "The Long Night" (the-long-night, 15p: 2 Vampires + Vampire Hunter
  + small Mafia + Town); validateSetup passes (VAMPIRE slot counts as a killing
  path in validate.ts). Added to leakcheck + sim CLI SETUP_MAPs.
- leak.ts KNOWN_ROLES += VAMPIRE, VAMPIRE_HUNTER. NO new whitelist needed (the
  knowledge-isolated design adds no secret-bearing frame type).

### Skipped / deferred
- NO vampire chat channel and NO vampire human-client night UI beyond the generic
  single-target picker (the engine/protocol/bots path is complete; a converted seat
  keeps its original role card by design, so the human-client convert experience is
  "you receive a `turned` note in your private log" — no new picker was required).
  The bot policy needs no vampire awareness: only the lowest-seat STARTING vampire's
  bite resolves, and the bite is a generic single-target ability the policy already
  drives.

## Cult conversion faction (fourth evil faction)

The Cult is Nocturne's SECOND conversion faction — built on the exact proven,
leak-safe scaffold the Vampire established. It grows by RECRUITMENT (a night
conversion that draws a seat TOWN/benign→CULT) and wins by parity. It is
deliberately KNOWLEDGE-ISOLATED like the Vampire so the information-leak invariant
stays trivially provable. What makes it DISTINCT from the Vampire:

- ONLY the Cult Leader recruits (one convert/night); the rank-and-file Cultists
  cannot grow the cult. Contrast: ANY vampire bites.
- Conversions STOP when the Cult Leader dies — a headless cult can still reach a
  parity win but can never grow again.
- A one-night COOLDOWN: the Cult Leader cannot recruit on consecutive nights
  (after a successful recruit it must rest a night). (The simple deterministic
  nuance, chosen over the "fresh-convert is settling" variant.)

### Leak-safety: knowledge-isolated (NO cult chat, NO roster)
- Cult shares NO secret chat (no 'cult' ChatChannel) and NO `your_role.mates`
  roster. Converted Cultists are NEVER told who the other cult members are (not
  even the Leader). The ONLY private info on conversion is the `recruited`
  private_result delivered to the converted seat alone — it carries NO other seat's
  identity or role (as leak-trivial as `roleblocked`/`turned`).
- `yourRoleEffect` emits mates ONLY for MAFIA/TRIAD (never CULT). UPDATE (role-card
  resend): a recruited seat IS now re-sent a fresh `your_role` at conversion so its
  UI reflects the CULTIST card — but because mates ship only to MAFIA/TRIAD, that
  resent frame carries the new role ONLY (NO roster), addressed to the seat alone.
  So no roster, no chat, the resent your_role carries no cross-seat secret ⇒ no new
  leak surface. The auditor needed only KNOWN_ROLES additions (CULT_LEADER, CULTIST).
  Verified: 0 leaks on classic 9p (200 games) and the-faithful / smoke-and-mirrors /
  the-long-night 15p sweeps (conversion + resend exercised).

### Conversion design
- WHO converts: ONLY the (unique) Cult Leader, and only if it is alive with a
  standing `recruit` intent and a valid living target. Cultists cannot recruit.
- COOLDOWN: a one-night cooldown. `cultLastRecruitNight` (GameState) records the
  night of the last successful recruit; if `nightNumber === cultLastRecruitNight +
  1` the recruit fails (the Leader rests the night after a conversion). Reset is
  unnecessary — the field only advances. Deterministic.
- WHAT is convertible: a living TOWN or NEUTRAL_BENIGN seat that is NOT already
  CULT and NOT night-immune. Mafia/Triad/Vampire/NK/other-neutrals resist (the
  recruit just fails). Same convertible set as the Vampire.
- DEATH-STOPS-GROWTH: the recruit only converts if the Cult Leader is still alive
  after the night's kills are settled (a Leader lynched/shot this night recruits no
  one; and with no Leader alive, future nights have no recruiter at all).
- ROLE/FACTION CHANGE: a successful recruit changes the target to role CULTIST +
  faction CULT (so investigations read consistently thereafter — sheriff-suspicious,
  investigator-R1, psychic-evil). Mirrors the vampire turn.
- IMMUNITY: the Cult Leader is NOT night-immune and NOT roleblock-immune (recorded;
  the town's counter is to find and kill/lynch the Leader). The recruit is a VISIT
  (a Lookout/Tracker/Veteran/Crusader/Ambusher sees it). NO cult kill — recruitment
  + parity is the entire win condition.
- Resolution order: the recruit is applied in resolve.ts step 8, AFTER kills are
  settled, exactly like the vampire convert. New ResolutionTrace
  `recruit {leader,target,recruited}`.

### Roles
- CULT_LEADER (faction CULT, UNIQUE): the converter. Sheriff-suspicious;
  investigator class R1 (hides among the soft Town/benign R1 set — Citizen,
  Survivor, Executioner, Amnesiac, Guardian Angel — so a single check never
  confirms it). NOT night-immune (recorded). No counter role is added — the town
  counters by killing/lynching the Leader (recorded).
- CULTIST (faction CULT): the converted body of the faction. Sheriff-suspicious;
  investigator class R1 (a fresh convert reads like an ordinary soul). Has no night
  ability — it exists to swell the parity count and cannot itself recruit.

### Win-check extension to a FOURTH evil faction
wincheck.ts already generalized Mafia/Triad/Vampire into a uniform `livingEvil`
list (length 1 ⇒ parity check). Adding the Cult is a UNIFORM list addition — NOT a
special case:
- `tally` gains a `cult` bucket; the `evilFactions` list gains CULT.
- Priority ladder slot: SK > Cult > Vampire > Triad > Mafia > Town. The Cult takes
  the highest evil priority (4) below SK, so a stalemate/endgame tie at the top
  resolves to the Cult over Vampire/Triad/Mafia. (Recorded.)
- Town wins iff no living Mafia, Triad, Vampire, Cult, OR NK. An evil faction F
  wins iff it is the SOLE living killing faction at parity. SK wins iff last killer.
  Two+ killing factions ⇒ continue. The pure evil-vs-evil endgame + stalemate
  ladders extend uniformly.
- New WinningParty CULT + WinCheckReason `cult_parity`.
- ALL pre-existing win/triad/vampire/determinism goldens stay GREEN; added goldens:
  cult parity win, town beats cult, cult-vs-mafia continue, a recruit growing the
  cult to a parity win, and recruitment stops when the Cult Leader dies.

### Additions (surfaces touched)
- Faction CULT (FactionSchema; compose/validate/builder records; client
  FACTION_LABEL + `--f-cult` ochre/gold-green [colorblind chartreuse] +
  .faction-CULT + IconCult eye-in-triangle glyph + FactionIcon case).
- WinningParty CULT + WINNER_LABEL line. WinCheckReason `cult_parity`.
- RoleIds CULT_LEADER (converter, unique) + CULTIST (body), original noir copy.
  INVESTIGATOR_CLASS_TABLE: both → R1. Sheriff: both suspicious. Psychic treats
  CULT as evil. UNIQUE_ROLES += CULT_LEADER.
- NightAbility `recruit` (CULT_LEADER); it visits. roleToNightAbility +
  abilityInfoFor (Recruit card). CULTIST has no night ability.
- NO new DeathCause (the Cult has no killing power). PrivateResultKind `recruited`
  (+ zod payload, strings, client PrivateLog rendering). ResolutionTrace `recruit`.
  GameState field `cultLastRecruitNight` (cooldown bookkeeping).
- Curated setup "The Faithful" (the-faithful, 15p: 1 Cult Leader + small Mafia +
  Town); validateSetup passes (a CULT_LEADER slot counts as a killing/terminal path
  in validate.ts — its recruitment drives the game to parity). Added to leakcheck +
  sim CLI SETUP_MAPs.
- leak.ts KNOWN_ROLES += CULT_LEADER, CULTIST. NO new whitelist needed (the
  knowledge-isolated design adds no secret-bearing frame type).

### Skipped / deferred
- NO cult chat channel and NO new human-client night UI beyond the generic
  single-target picker (the engine/protocol/bots path is complete; a recruited seat
  keeps its original role card by design — the convert experience is "you receive a
  `recruited` note in your private log"). The bot policy needs no cult awareness:
  only the (unique) Cult Leader recruits, via the generic single-target `recruit`
  ability the policy already drives.

---

## Role expansion — Transporter / Coroner / Trapper (batch F)

Three distinct-mechanic TOWN roles. All shipped (none skipped). Original noir copy;
generic names (Transporter/Coroner/Trapper). DETERMINISM + the info-leak invariant
held: engine determinism property test green; classic leak sweep 0/200; the new
"Cold Cases" curated setup leak sweep 0 leaks across 60 games (15p, all completed).

### Transporter (the "bus driver")
- TOWN support, `transport` NightAbility, uses the existing optional `target2`
  field (plumbed in apply.ts alongside the Witch — generalized the witch-only
  two-target guard to `witch_control || transport`). InvestigatorClass R8; Sheriff
  not_suspicious; not unique.
- MECHANIC: choose two seats (a,b) and SWAP them — every action/visit aimed at a is
  redirected onto b and vice-versa (a kill on a lands on b; a Doctor healing a heals
  b; a watcher of a watches b). The two swapped seats still act normally on their
  OWN turn — transport only rewrites actions TARGETING them.
- PIPELINE STEP: a new "Step 0.6", immediately AFTER the Witch control step (Step
  0.5) and BEFORE jail/roleblock/kills — mirroring where the Witch's redirect is
  applied. RECORDED ORDER vs the Witch: Witch control resolves FIRST (the puppet's
  intent already points at the Witch's victim), THEN the Transport swap rewrites
  that (and every other) target. Golden confirms: a Witch-steered Sheriff onto seat
  4, then a Transporter swapping 4↔5, lands the investigation on seat 5; the `witch`
  trace precedes the `transport` trace.
- DETERMINISM: a FIXED swap, no randomness. Transporters resolve in ascending seat
  order; each applies its single swap to EVERY intent's target/target2, so multiple
  Transporters compose as sequential swaps. Each seat may be a swap endpoint at most
  once per night (lower-seat Transporter wins) → the composition is a clean
  permutation. NO-OP (`swapped:false`) on a===b, a self/dead endpoint, or an
  endpoint already taken by a lower-seat Transporter.
- VISITS: the Transporter visits BOTH houses it switched. Because one intent cannot
  carry two visit edges, the two edges are recorded in an `extraVisits` list that is
  threaded into ALL visitor consumers (lowestVisitorTo/visitorsTo gained an optional
  param; the Veteran loop, the step-6 visitorsByTarget/visitedByActor maps, and the
  Coroner/Trapper reads all fold it in). `actorVisits('transport')` returns false
  (its single `target` would otherwise double-count) and the swap loop skips
  rewriting a Transporter's own swap-pair intent.
- New ResolutionTrace `transport`. NO new private_result (the Transporter learns
  nothing — pure redirect), so NO leak surface added.
- Golden: kill-on-A-lands-on-B PASSES; plus heal-redirect, visit-redirect,
  visits-both, degenerate-no-op, Witch-interaction, and a determinism check.

### Coroner (autopsy the dead)
- TOWN investigative, `autopsy` NightAbility. InvestigatorClass R3; Sheriff
  not_suspicious; not unique.
- MECHANIC: each night open ONE DEAD seat → learn its exact (apparent) ROLE and the
  sorted seats that VISITED it the night it died. A living / Janitor-cleaned-secret
  target is no valid corpse (`read:false`, no result).
- New SeatState field `deathVisitors` (frozen at death in Step 7 from that night's
  visit graph, excluding self; never rewritten). New ResolutionTrace `autopsy`.
- New private_result `coroner_result` (target, role, visitors). It carries a role
  STRING — but of an ALREADY-publicly-revealed dead seat (its death_announce already
  leaked it), so it leaks nothing new. Whitelisted in BOTH auditors as a per-seat
  role carrier (bots/leak.ts `mentionsRoleForOtherSeat` + engine leak.test.ts), like
  consigliere_result/janitor_result. The cross-capture deep scan would clear it
  anyway (the autopsied seat is in the `revealed` set by then); the whitelist makes
  intent explicit.

### Trapper (snare that shields + names, never kills)
- TOWN protective, `trap` NightAbility. InvestigatorClass R7; Sheriff
  not_suspicious; not unique.
- MECHANIC: a single-night armed trap at a ward. It (1) PROTECTS the ward from one
  basic attack — mechanically the SAME one-attack shield as a Doctor heal, set in
  Step 3 (lowest-seat protector wins; a revealed Mayor can't be shielded), and (2)
  in Step 6 names the LOWEST-seat caller at the ward (the same visitor set the
  Crusader strikes, incl. the Transporter's extra edges), excluding the ward + the
  Trapper.
- DISTINCT FROM CRUSADER (recorded): the Crusader KILLS the caller it catches (a
  basic Town attack, death cause `crusader`); the Trapper does NOT kill — it only
  PROTECTS + INFORMS. The caught caller stays alive. Golden asserts the caught
  Mafioso is ALIVE after the trap reports it.
- New ResolutionTrace `trap` (ward, caught, sprung). New private_result
  `trapper_result` (target ward, caught seat) — carries ONLY seat ids, NO role
  strings, so it is leak-trivial (no whitelist needed).

### Surfaces touched
- RoleIds TRANSPORTER/CORONER/TRAPPER (+ role defs, original copy, index registry).
  INVESTIGATOR_CLASS_TABLE: CORONER→R3, TRAPPER→R7, TRANSPORTER→R8 (+ roles.test.ts
  SPEC_TABLE mirrored). Sheriff: all not_suspicious. None unique.
- NightAbility `transport`/`autopsy`/`trap`; roleToNightAbility + abilityInfoFor
  (Transport / Autopsy / Set trap cards). apply.ts: two-target plumbing generalized
  to also accept `transport`. SeatState `deathVisitors` (init.ts + harness seed +
  structuredClone deep-copies it).
- PrivateResultKind coroner_result/trapper_result (+ zod payloads, strings
  coronerResultLine/trapperResultLine, strings.test dynamic list, client PrivateLog
  rendering).
- Client OwnPanel: the Witch two-target picker generalized into `TwoTargetAction`
  (takes a `labels` set); `transport` routes to it with Transporter labels (GAME
  transportFirst/Second/…). Witch picker behavior unchanged; +client picker test.
- Curated setup "Cold Cases" (cold-cases, 15p: Transporter+Coroner+Trapper fixed +
  Mafia w/ Janitor + SK/Jester/Exe/Survivor). Registered in SETUPS, leakcheck +
  sim CLI SETUP_MAPs, setups.test (count 9→10). The three roles also added to its
  townPool.
- leak.ts KNOWN_ROLES += TRANSPORTER/CORONER/TRAPPER; coroner_result whitelisted.
  bots policy drives `transport` as a two-target action (mirror of witch_control);
  autopsy/trap use the generic single-target picker (autopsy on a living seat is a
  harmless no-op in the sweep — the dead are not targetable by the policy).

### Notes / rough edges
- Cold Cases games run ~3x slower per game than other 15p curated setups (~2.4s vs
  ~0.9s) — NOT a non-termination bug (step counts ~28–66, identical range to
  reckoning; all 60 sweep games completed). The cost is per-resolveNight/audit work
  on boards where the Transporter+Trapper keep more town alive longer (more intents
  + more audited frames per night). A long default-200 leak sweep on cold-cases
  therefore takes minutes; the gate was run at 60 games (0 leaks) per spec.
- The Coroner reads the APPARENT role (a Disguiser's borrowed face), matching every
  other reveal; a Janitor-cleaned (secret) body is not autopsy-able (nothing on the
  slab) — consistent with its public reveal carrying no role.

## GAME RULE: death is permanent — remove Medium (séance) + Retributionist (revive)

New non-negotiable rule: **death is permanent, and no LIVING player may ever
contact the dead.** The dead-only `dead` channel STAYS (the dead chat among
themselves); what is removed is every LIVING→DEAD bridge and every revival.

### Removed
- **MEDIUM** role + its `seance` day-ability (the séance was the only living→dead
  chat bridge). Deleted `packages/shared/src/roles/medium.ts`.
- **RETRIBUTIONIST** role + its `retribute` night revive (revival violates "death
  is permanent"). Deleted `packages/shared/src/roles/retributionist.ts`.
- Kept Coroner / Disguiser / Amnesiac / Vampire / Cult — they read the dead
  (forensics) / adopt a dead role / convert the LIVING; none chat with or revive
  the dead.

### Dead channel is now strictly dead-only (the teeth of the rule)
- engine `apply.ts` `handleChat` `'dead'` case: stripped the séance branch
  entirely. Now `if (s.alive) return;` — a LIVING seat can neither post to nor be
  addressed in the dead channel; `toDead` addresses dead seats alone. Re-verified
  by a new engine golden ("dead channel is strictly dead-only") AND the bots leak
  auditor (the auditor already flags a spectator receiving dead chat; a living
  non-spectator now also has no path in).
- client `channels.ts`: removed the `isMedium`/`seancePending` séance path; the
  `dead` tab is offered/writable ONLY to actually-DEAD seats. Removed the
  `seancePending` store flag + its reducer (`day_ability_ack ability==='seance'`)
  and the OwnPanel `SeanceControl`.

### Setup-slot replacements (each still PASSES validateSetup at 15p)
- **Smoke and Mirrors** (`smoke-and-mirrors`): the fixed `MEDIUM` slot → **SPY**
  (a batch-B Town information role already in this setup's townPool; keeps the
  "make every late-night visit count" theme). townPool drops `MEDIUM` (SPY already
  present). 15 slots, killing role present, uniques ≤1 — validates `{ok:true}`.
- **The Reckoning** (`reckoning`): the fixed `RETRIBUTIONIST` slot → **CORONER**
  (a Town investigative role that READS the dead on the slab — forensics, NOT
  contact/revival — fitting the rule). townPool `RETRIBUTIONIST`→`CORONER`. 15
  slots, validates `{ok:true}`. Descriptions/comments updated to match.

### Surfaces touched (exhaustive)
- shared: deleted both role files; removed from roles/index.ts (imports,
  re-exports, ROLES, ALL_ROLES) + INVESTIGATOR_CLASS_TABLE (RETRI from R2, MEDIUM
  from R4); RoleId enum/schema (ROLE_IDS); constants `MEDIUM_SEANCES` +
  `RETRIBUTIONIST_REVIVES` deleted; curated.ts slot+townPool+copy swaps;
  protocol/objects.ts targetDomain doc (dropped retribute/séance mentions);
  roles.test.ts (UNIQUE_ROLES, class table, dropped `ROLES.MEDIUM.uses` assert).
  UNIQUE_ROLES auto-shrinks (RETRI was unique; MEDIUM was not). Role count 52→50.
- engine: state.ts (NightAbility `retribute` removed; `seanceMedium` field +
  `retribute` ResolutionTrace removed); apply.ts (dead-only handleChat; removed
  `seance` day-ability case + the night-close séance-consume block; DayAbility
  ability narrowed to `'jail'|'reveal'`); events.ts DayAbilityEvent ability
  narrowed; resolve.ts (removed the whole retribute revive branch + its `visits`
  case + a séance doc mention); roleinfo.ts (roleToNightAbility RETRI,
  ABILITY_DOMAIN/VERB seance+retribute, abilityInfoFor MEDIUM+RETRI cases, doc);
  init.ts (uses cases + `seanceMedium` init + imports). Tests: deleted the batch-B
  Medium describe (replaced with a dead-only golden), the batch-E Retributionist
  describe, the your-role-resend RETRI/MEDIUM tuples, harness FACTION/USES entries.
- bots: leak.ts KNOWN_ROLES dropped MEDIUM/RETRIBUTIONIST (no seance/retribute
  private_result whitelist existed). leakcheck/sim SETUP_MAPs unchanged — the
  `smoke-and-mirrors`/`reckoning` setup IDS still exist (only their composition
  changed).
- client: store types/reducer/store (`seancePending` gone), GameScreen (`isMedium`
  + ctx), OwnPanel (SeanceControl + retribute dead-target Town-restriction removed;
  DeadTargetGrid simplified to list any dead), strings-extra (séance keys,
  retributeTownHint, retribute trace-label removed). Glossary is data-driven off
  ALL_ROLES so it auto-drops both roles; its test asserts `=== ALL_ROLES.length`
  and stays green. Client tests updated (channels-chat dead-only, own-panel-actions
  séance/retri removed, reducer/director seancePending fields).

### Gate (all GREEN; nothing committed, no pm2 restart)
- `pnpm -r build` clean (all 5 packages incl. server). `pnpm -r test`: shared 186,
  engine 225, client 157, server 56, bots 36 — all pass. `npx eslint .` clean.
- Leak sweeps (inline, NO_DB, redirected): classic 9p ×200 → **0**; smoke-and-mirrors
  15p ×60 → **0**; reckoning 15p ×60 → **0**; the-long-night 15p ×50 → **0**.
- Determinism/purity property tests pass (`§12.1`: same seed ⇒ identical hash; init
  determinism; termination; leak-shape). Role count == **50**.

## DATA LAYER: ranked play + role-preference unlocks (Glicko-2)

Added the persistence foundation for ranked queues, seasons, MMR, and per-user
role likes/blacklists. **DB layer only** — no engine/server-logic/client changes;
ranking math + unlock gameplay are built by other agents on these primitives. The
engine stays pure; all rating computation will happen server-side at match end
(mirrors the points system, which also lives outside the engine).

### Tables added to `schema.sql` (idempotent, mirroring existing style)
- `seasons (id uuid pk, name text, started_at, ended_at null, is_current bool)`
  — partial unique index `seasons_one_current_idx ON (is_current) WHERE is_current`
  enforces **at most one current season**.
- `ratings (user_id→users ON DELETE CASCADE, mode text, season_id uuid, mmr=1500,
  rd=350, vol=0.06, games, wins, updated_at; PK (user_id, mode, season_id))`
  — Glicko-2 state (mmr=rating r, rd=deviation, vol=volatility). Index
  `ratings_leaderboard_idx ON (mode, season_id, mmr DESC)` for the ranked board.
- `role_preferences (user_id→users CASCADE, role text, preference text
  /* 'blacklist' | 'prefer' */, created_at; PK (user_id, role))`.
- `ranked_results (match_id uuid, user_id uuid, mode, mmr_before/after,
  rd_before/after, delta, created_at; PK (match_id, user_id))` — append-only
  per-match rating deltas; **no FK** on match_id/user_id so a result survives
  even if a match row is pruned. Index `ranked_results_user_idx ON
  (user_id, created_at DESC)` for match history.
- `matches`: added `mode text` (casual|ranked|quickplay) + `season_id uuid`,
  both nullable, in the CREATE plus idempotent `ADD COLUMN IF NOT EXISTS`.

### Store interface (`db/types.ts`) + both impls (`pg-store`, `memory-store`)
- New types: `SeasonRow`, `RatingRow`, `RolePreference`, `RankedResultInput`,
  `RatingLeaderboardEntry` (re-exported via `db/index.ts`'s `export *`).
- New methods (in `Store`, implemented in both stores):
  `getCurrentSeason`, `ensureCurrentSeason(name)`, `getRating(userId,mode,seasonId)`,
  `upsertRating(row)`, `getRatingLeaderboard(mode,seasonId,limit)`,
  `getRolePreferences(userId)`, `setRolePreference(userId,role,preference|null)`
  (null removes the row), `writeRankedResults(rows)` (bulk, ignore-conflict),
  `getRankedResults(userId,limit)` (newest-first).
- `MatchRecord` gained **optional** `mode?`/`seasonId?` — the existing
  `manager.ts` `writeMatch` caller omits them and still compiles (persists
  casual). `writeMatch` writes them when present (null otherwise).
- `MemoryStore` keeps in-process maps (NO_DB is guests-only): single
  `currentSeason`, a `ratings` map keyed `${user} ${mode} ${season}`, a nested
  `rolePrefs` map, and an append-order `rankedResults` array.

### Gate (all GREEN; nothing committed, no pm2 restart, migration NOT run on live DB)
- `pnpm --filter @nocturne/server typecheck` clean. `pnpm -r build` clean (all 5
  packages). `pnpm -r test`: shared 186, engine 225, client 163, server 56,
  bots 36 — all pass. `npx eslint .` clean (exit 0).
- No leak/determinism impact (DB layer only; engine untouched). MemoryStore
  (used by the server test harness) gains sane in-process implementations.

---

## Points economy expansion — role-win + feat achievements + unlock model

Goal: make lifetime points a status symbol and the backbone for unlocks, with a
much larger achievement set rewarding playing/winning/odd feats. Touched only
`shared/types/points.ts` + a new `shared/types/achievements.ts` (exported via
`types/index.ts`) and `server/points/award.ts` (+ their tests). DB/engine/client
untouched (the client glossary/achievements UI is data-driven off `ACHIEVEMENTS`,
so it auto-absorbs the new entries; no client test asserts an achievement count).

### Role-win achievements (generated, one per role)
- **[points] One `win_<roleid_lowercase>` achievement per role in `ALL_ROLES`**,
  generated in `achievements.ts` (`ROLE_WIN_ACHIEVEMENTS`) so the list
  auto-tracks the 50-role roster — add a role and it gets a win achievement with
  no edit. Name `Win as <RoleName>`, original faction-flavoured noir copy.
- **[points] Point tiers by `roleWinPoints(role)`:** COMMON 25 (Town / Mafia /
  Triad / Cult body / support neutrals), KILLER 40 (NEUTRAL_KILLING + VAMPIRE +
  the unique CULT_LEADER converter), TRICKSTER 50 (Jester, Executioner, Pirate,
  Witch). Constants in `ROLE_WIN_POINTS`; tiering is faction-driven so it tracks
  the roster. `ROLE_WIN_KEY_BY_ROLE` maps engine RoleId → win key for the server
  detector.

### Feat achievements (18 shipped, all detectable from match-player data)
- **[points] Shipped feats** (key — condition — pts): `feat_dead_man_wins` (die
  N1, still win — 40); `feat_first_blood` "Cold Open" (first body, dead N1 — 15);
  `feat_last_town_standing` (win as the only surviving Town — needs the full
  roster, passed in — 45); `feat_final_curtain` (win a 7+ day game — 35);
  `feat_long_haul` (survive a 7+ day game — 40); `feat_martyrs_vindication` (win
  while lynched loyal Town — 40); `feat_turncoat` (win with FINAL role VAMPIRE —
  45); `feat_converted_faithful` (win with FINAL role CULTIST — 45);
  `feat_ghost_of_the_house` (win with 5+ days dead — 30); `feat_untouchable`
  (win alive — 25); `feat_pyrrhic` (win on the day you died — 35);
  `feat_solo_carry` (NEUTRAL_KILLING wins alive — 50); `feat_kingmaker`
  (Executioner win — 45); `feat_one_more_drink` (Survivor win — 35);
  `feat_plague_apotheosis` (Pestilence win — 50); `feat_house_always_wins`
  (Pirate win — 50); `feat_grim_loyalty` (die by day 2, stay, win — 35);
  `feat_clean_hands` (Town win, alive — 30).
- **[points] Detectability decision:** only feats derivable from the per-seat
  `MatchPlayerRecord` (`outcome`/`survived`/`deathDay`/`role`/`faction`) + match
  `finalDay`, plus (for `feat_last_town_standing`) the full player roster which
  `detectAchievements` now also receives. `role`/`faction` on the record are the
  seat's FINAL state at reveal, so conversions are honoured (a turned Vampire who
  wins earns `win_vampire` + `feat_turncoat`).
- **[points] SKIPPED as undetectable with today's signals** (would need extra
  per-night state the match record does not carry): *never-targeted survivor*
  (needs a per-seat "was visited/targeted" flag across all nights); *comeback /
  numbers-disadvantage* (needs per-day faction-count history); *clean sweep with
  zero Town deaths* — note `feat_clean_hands` ships the detectable weaker form
  (this seat won for Town and lived), not the whole-team-untouched version, which
  would need a per-Town-seat death tally (derivable from the roster but
  deliberately deferred to avoid over-claiming). The existing `clean_sweep`,
  `last_laugh`, `lone_wolf` core achievements are kept and NOT duplicated by the
  new feats.

### Unlock-threshold model (basis for role-preference, goal 3)
- **[points] `UNLOCKS = { ROLE_BLACKLIST_AT: 2500, ROLE_PREFER_AT: 6000 }`** +
  pure `unlocksFor(totalPoints): { canBlacklistRoles, canPreferRoles, nextUnlock
  }` in `points.ts`. Blacklisting (never be dealt a role) unlocks first, role
  preference (weighted toward) higher up; `nextUnlock` drives a "X to go" UI.
  Tunable constants; gates the later role-preference feature with one call.

### Award detection (`server/points/award.ts`)
- `detectAchievements` now also takes the full `players` roster; it pushes
  `ROLE_WIN_KEY_BY_ROLE[p.role]` on a win and the 18 feat keys from the same
  signals, then keeps the existing catalog-filter + first-time-only
  `store.unlockAchievements` semantics, so role-win/feat points flow through the
  unchanged breakdown/`recordPoints` path. Exported for unit testing.

### Gate (all GREEN; nothing committed, no pm2 restart)
- `pnpm --filter @nocturne/shared build` clean. `pnpm -r build` clean (all 5
  packages). `pnpm -r test`: shared 194, engine 225, client 163, server 70,
  bots 36 — all pass. `npx eslint .` clean (exit 0).
- Final achievement count: **79** (11 core + 50 role-win + 18 feat), all keys
  unique. No leak/determinism impact — points are server-side, computed at game
  end; the engine is untouched.

## QUICK PLAY: matchmaking with bot-backfill (cold-start linchpin)

The front-door "Quick Play" CTA: a player (incl. a guest) clicks once and ALWAYS
gets a full game within seconds — concurrent human queuers share the table, AI
bots backfill the rest, and the game AUTO-STARTS (no host "Deal" click). Makes
the game playable with zero population.

### Matchmaker (`server/src/lobby/matchmaker.ts`)
- In-memory FIFO queue owned by the `LobbyManager` (`manager.matchmaker`). On the
  FIRST entrant an empty queue arms a **fill window** (`FILL_WINDOW_MS = 12s`,
  tunable) so other humans can join one table; forms immediately at the table cap
  (`TABLE_CAP = 15`). On window expiry it FORMS: creates a forced-**private**,
  non-test `classic-nocturne` lobby (guests allowed; NOT in the public browser),
  moves all queued humans in, backfills bots up to `TARGET_SEATS` (=MIN_PLAYERS=7),
  and system-starts. A solo queuer → 1 human + 6 bots = instant 7p game.
- **Bot policy:** SCRIPTED is the reliable default + the floor (legal,
  deterministic moves). A few LLM bots (`MAX_LLM_BACKFILL = 2`) are added ONLY
  when `LLM_BASE_URL` is configured; `BotManager.addBots` already falls back to
  scripted if the LLM is unreachable, so LLM trouble NEVER blocks a match.
- **Timing seam:** the fill window + bot-join poll run on REAL timers (bots
  connect over real loopback WS in real time), independent of the room's
  clock/schedule seam. Tunable via `ManagerDeps.matchmakingTimings` (tests inject
  tiny values; production omits it). Reuses `BotManager.addBots` verbatim — it
  was already generic, not test-mode-bound (only the `testControl` caller gated
  it). Disconnect/leave/empty-queue all cancel cleanly; a table that can't fill
  is disposed (bots dropped) and seated humans get a `cannot_start` error.

### LobbyManager refactor (system-triggered start)
- Extracted `startGame`'s core into a private `formGame(lobby, {mode?})`. The
  host-triggered `startGame(conn)` keeps its host/`canStart` checks then calls it;
  the new system-triggered `startMatchmadeGame(lobby)` re-checks `canStart()` and
  calls it with `mode:'quickplay'` — NO host-click gate. `Room.mode` (new mutable
  field, like `godIdentityId`) flows to `writeMatch` so `MatchRecord.mode` (was
  already optional) persists `'quickplay'` for matchmade tables, casual otherwise.

### Protocol (shared) — exact shapes
- client→server: `quick_play {}` (enter queue), `leave_queue {}`.
- server→client: `queue_status { state:'searching'|'matched'|'cancelled',
  position?, queued?, eta?, lobbyId? }`. Leak-safe (no secret). `searching`
  drives the "finding a table…" overlay; `matched` (with `lobbyId`) just tells the
  client to drop the overlay — the normal `lobby_state`/`game_started`/`your_role`
  frames follow and `useLobbyNav` routes into the game.

### Client
- HomeScreen: a prominent brass `Quick Play` hero CTA + a noir/deco
  "Finding you a table…" overlay (spinner, queue position, Cancel → `leave_queue`)
  driven by a new server-sourced `matchmaking` store slice (cleared on
  lobby_state/game_started/cancelled — store still holds only server data, §13.2).
  New copy in `lib/strings-extra.ts` (shared strings untouched); new `.quickplay*`
  / `.qp-*` CSS (reduced-motion aware).

### §5 leak invariant — UNCHANGED and re-proven
- Matchmade tables run the NORMAL Room/transport; bots are ordinary guest WS
  clients with no engine access. Nothing bypasses `transport.ts`. Leak sweep
  `NO_DB=1 node packages/bots/dist/cli/leakcheck.js` → **0 leaks / 200 games**
  (classic-nocturne 9p AND 7p — the solo-quickplay table size).

### Gate (all GREEN; nothing committed, no pm2 restart)
- `pnpm --filter @nocturne/shared build` + `pnpm -r build` clean (all 5 packages).
  `pnpm -r test`: shared 199, engine 225, client 166, server 76, bots 36 — pass
  (+5 protocol round-trips, +3 client reducer, +6 matchmaker incl. a real-server
  E2E proving a SOLO quick_play forms+starts+TERMINATES a 7p game with bots).
  `npx eslint .` clean (exit 0). Leak sweep 0/200.

---

## Ranked Play (MMR + matchmaking + seasons + ranked leaderboards)

Built on the existing ratings/seasons/ranked_results foundation (already in the
Store + schema) and the Quick-Play matchmaker. Competitive ranking is SEPARATE
from the lifetime-points ladder (`POINTS_TIERS` drifter→kingpin): different math,
different names, different wire fields.

### (a) Glicko-2 rating math (`packages/shared/src/types/glicko.ts`, pure + tested)
- Full Glicko-2 (Glickman 2013): `toGlicko2`/`fromGlicko2` scale conversions
  (factor 173.7178) + `updateRating(player, opponents[])` over a rating period of
  one or more results, including the Illinois-algorithm volatility solve and the
  "did-not-compete" RD-inflation rule. System constant **tau = 0.5**. Pure: no
  I/O, no Date.now, no Math.random.
- VALIDATED against Glickman's published worked example: player (1500, 200, 0.06),
  tau 0.5, win vs (1400,30) / loss vs (1550,100) / loss vs (1700,300) ⇒
  rating≈1464.06, rd≈151.52, vol≈0.05999. `glicko.test.ts` asserts these to the
  reference decimals, plus monotonicity (win up / loss down, beating a stronger
  field gains more) and the rank ladder.

### (b) Match → MMR model (`packages/server/src/ranked/rate.ts`, pure; `award.ts`, persistence)
- At onGameOver, RANKED matches only. Partition the match's HUMAN players
  (non-`guest:`, non-bot) into WINNERS (seat outcome === 'win') and LOSERS
  (anything else: loss/draw/left).
- Each human plays ONE Glicko-2 rating period vs a single synthetic opponent =
  the AVERAGE rating of the OPPOSING human group (opponent RD = that group's mean
  RD): winners vs losers' mean (score 1), losers vs winners' mean (score 0).
- If a side has ZERO humans (solo human carried by bots, or an all-human sweep),
  the opponent falls back to a fixed BOT baseline (rating 1500, rd 350) with the
  appropriate score — so a lone human still moves, just vs the baseline.
- **Bot-heavy dampening (exact formula):** `humanDensity = humanCount / totalSeats`
  (clamped to (0,1]). Each human's rating/rd/vol DELTA is scaled linearly by
  density: `after = before + (raw - before) * density`. A 1-human/6-bot game
  (density 1/7) moves MMR ≈ 1/7 of an all-human game; an all-human game moves it
  fully. Linear is simple, monotonic, easy to reason about.
- Bots get NO rating; guests excluded (no account ⇒ no MMR) — filtered in
  `award.ts` by the `guest:` prefix, exactly as points are. TEST-mode games never
  count. Persist per human: `upsertRating` (games+1, wins+win?1:0, scoped to the
  CURRENT season) and `writeRankedResults` (mmr_before/after, rd_before/after,
  delta, mode='ranked', match_id, user_id; (match,user) idempotent). Seedless +
  pure rating math ⇒ deterministic given the inputs.

### (c) Ranked queue / protocol
- Chose to EXTEND `quick_play` with an optional `mode: 'casual' | 'ranked'`
  (default casual) rather than a new message — fewer moving parts, the queue
  overlay/flow is identical. `queue_status` gains an optional `mode` so the
  overlay shows ranked copy. The LobbyManager runs TWO Matchmaker instances
  (`matchmaker` casual, `rankedMatchmaker` ranked); the matchmaker is mode-aware
  and tags its games via `startMatchmadeGame(lobbyId, mode)`.
- **Account gating:** ranked requires a registered account — `quickPlay(conn,
  'ranked')` rejects guests with `not_authenticated` (the client prompts to sign
  in) and requires a persistent store + an open season.
- **MMR bucketing:** the ranked matchmaker anchors on the longest-waiting queuer
  and forms a table from the closest-MMR cluster within a tolerance that WIDENS
  with wait time (base 150 + 50/sec). It ALWAYS backfills with bots and ALWAYS
  forms (cold-start rule): a lone or far-apart player still gets a table once its
  tolerance widens. A synchronous `mmrCache` (refreshed on enqueue / at game over)
  feeds bucketing; casual ignores it.

### (d) Seasons
- `LobbyManager.ensureSeason('Season 1')` is called on boot (app.ts, after the
  manager is built) and caches the current season id. Ranked matches + ratings +
  results are tagged with it (`room.seasonId`, persisted on the match record).
  Season rollover / soft-reset is a documented STUB — we only guarantee exactly
  one current season exists. No persistent store (NO_DB) ⇒ ranked is unavailable
  (ensureSeason is a no-op; the queue rejects with `cannot_start`).

### (e) Rank tiers + display (`glicko.ts` — `rankForMmr` / `nextRankThreshold`)
- 7-rung noir ladder, ORIGINAL and DISTINCT from the points tiers:
  **Stray Cat (0) · Bagman (1300) · Fixer (1500) · Shadow (1700) · Enforcer
  (1900) · Consigliere (2100) · The Don (2300).** Floor-keyed, total over all MMR.
  `rankForMmr(mmr)` ⇒ {key, name, index}; `nextRankThreshold` ⇒ next rung or null.
- Wire: `UserRankSummary` (glicko.ts) + a zod `RankedSummary` carried inline on
  `UserStatsSummary.ranked` ({mmr, rd, rank, rankName, games, wins, seasonId},
  rank derived server-side). `points_awarded` gains an optional `rankedDelta`.
- Displayed: a `RankBadge` (spade pip, squared shape, per-rank color ramp —
  visually distinct from the round `TierBadge`) on the profile/dossier (rank +
  MMR stats) and the game-over screen (a "+18 MMR" / "−12 MMR" delta line + new
  rank), and the Leaderboard's new **Casual (Reputation) / Ranked (MMR)** toggle.
  A Ranked button sits next to Quick Play on the home screen (guest ⇒ sign-in
  prompt). Copy in `lib/strings-extra.ts` (shared strings untouched); new
  `.rank-*` / `.btn-ranked` / `.lb-tabs` / `.ranked-delta` CSS.

### (f) Endpoints
- `GET /api/leaderboard/ranked?limit=` — top MMR for the current season + ranked
  mode, joined to usernames, each row carrying the derived rank.
- `GET /api/rank/:userId` — public ranked standing for a user (current season).
- `/api/me` now includes the caller's `ranked` standing inline on `stats` when
  they have a rating this season.

### §5 leak invariant — UNCHANGED and re-proven
- Ranked games are NORMAL games tagged mode='ranked' + bots; MMR updates are
  POST-game DB writes, never frames. Nothing new reaches a socket in-game. Leak
  sweep `NO_DB=1 node packages/bots/dist/cli/leakcheck.js` → **0 leaks / 200 games.**

### Gate (all GREEN; nothing committed, no pm2 restart)
- `pnpm --filter @nocturne/shared build` + `pnpm -r build` clean (5 packages).
  `pnpm -r test`: shared 210, engine 225, client 167, server 91, bots 36 — pass.
  New tests: Glicko-2 vs reference values (glicko.test.ts), the match→MMR model
  (rate.test.ts: winners gain/losers lose, density dampening, solo-vs-bots tiny
  delta, opposing-average), the ranked award (award.test.ts: humans-only ratings
  + ranked_results, guest/bot exclusion, idempotent ledger, rank-from-MMR),
  ranked queue bucketing + the guest-rejected-from-ranked E2E (matchmaker.test.ts),
  and a ranked queue_status reducer case. `npx eslint .` clean (exit 0).

---

## Goal 3 — Point-unlocked role preferences (blacklist / prefer)

Point-unlocked, deterministic, gated. At `UNLOCKS.ROLE_BLACKLIST_AT` (2500) a
player may BLACKLIST roles (never be dealt them — best-effort, non-guaranteed);
at `UNLOCKS.ROLE_PREFER_AT` (6000) they may PREFER roles (weighted toward, NOT
guaranteed). The role MULTISET is still fixed by the setup — preferences only
influence the seat↔role permutation. Determinism + the §5 leak invariant are
unchanged and re-proven.

### (a) Preference-aware, still-deterministic assignment (engine)
- `InitOptions.seatPreferences?: SeatPreference[]` (seat/roster-indexed;
  `{ blacklist: string[]; prefer: string[] }`). ABSENT or all-empty ⇒ the
  byte-identical no-preference path.
- `assignRoles` ALWAYS runs the existing baseline Fisher–Yates shuffle and
  consumes the PRNG exactly as before. ONLY when ≥1 seat declares a preference
  does it then call `assignWithPreferences`, advancing the PRNG further and
  re-deriving the permutation. No prefs ⇒ PRNG state + result identical (this is
  the no-prefs-is-identical guarantee; verified by hashState equality across
  player counts 7–15, and all 225 prior engine tests pass untouched).
- `assignWithPreferences` is a SEEDED greedy assignment with weighted
  tie-breaking, over the SAME multiset:
  - Seats are ordered most-constrained-first (fewest non-blacklisted distinct
    roles, ties by seat index) — a deterministic order independent of the PRNG.
  - Each seat picks from the remaining pool: candidates = non-blacklisted
    remaining roles (fall back to ALL remaining only if over-constrained — the
    documented blacklist non-guarantee). Each candidate is weighted
    (PREFER_WEIGHT=4 for a preferred role, else 1) and ONE is drawn via a single
    seeded `weightedPick` step. Same (roles, prefs, prng) ⇒ identical result.
  - Blacklist = hard-avoid (zero violations whenever a conflict-free assignment
    exists, which is every realistic sparse-blacklist case; minimized otherwise).
  - Prefer = soft-weight (more likely, never guaranteed).
- Role ids are typed `string[]` (engine + adapter): set-membership compares to
  the drawn multiset, so a stale/unknown id simply never matches — harmless.
- New tests (`packages/engine/test/preferences.test.ts`, 7): no-prefs ⇒ identical
  hashState; prefs never change the multiset/counts; same (setup,seed,prefs) ⇒
  identical hashState; blacklisted role avoided over 200 seeds; multiple distinct
  blacklists all honored; preferred role hit MORE than chance over 600 seeds;
  over-constrained blacklist degrades gracefully (exactly one forced violation,
  multiset intact, no crash).

### (b) server→engine threading + the server-side unlock gate
- New `packages/server/src/lobby/preferences.ts`:
  `fetchGatedSeatPreference(store, identityId)` reads `getRolePreferences` +
  `getUserStats.totalPoints`, applies `unlocksFor(points)`, and DROPS entries the
  player has not unlocked (blacklist only if ≥2500, prefer only if ≥6000).
  Returns null for guests (`guest:` ids) / bots / NO_DB / no prefs. This is the
  authority — a tampered client cannot bypass it. (Verified standalone:
  below-2500⇒null, 2500–6000⇒blacklist-only, ≥6000⇒both, guest⇒null.)
- The synchronous start path is preserved (no big async refactor): gated prefs
  are cached on `Connection.seatPreference` at lobby-join (async, best-effort)
  and REFRESHED for all players just before forming the game. `startGame` (the
  host "Deal" path) is now `async` and awaits `refreshLobbyPreferences(lobby)`;
  `onStartGame` awaits it. Matchmade tables rely on the join-time cache.
- `formGame` attaches each player's cached `seatPreference` to the roster;
  `room.init` builds the seat-indexed array and passes `seatPreferences` into the
  engine ONLY when at least one is non-empty (else omitted ⇒ no-pref path).
  Guests/bots carry null ⇒ empty ⇒ no effect.

### (c) Endpoints (account-only; gate enforced server-side)
- `GET /api/me/preferences` → `{ unlocks: unlocksFor(points), preferences: [{role,
  preference}] }`. 401 guest-less, 403 guest.
- `POST /api/preferences { role, preference: 'blacklist'|'prefer'|null }` — zod
  `RoleIdSchema` validates the role; the unlock GATE is enforced on write (403
  `{error:'locked', unlock}` for a tier the player hasn't reached). Clearing
  (null) is always allowed. `registerPreferencesRoutes` wired in `app.ts`.

### (d) Client UI (gated on unlocks)
- New `/preferences` route + `PreferencesScreen` ("Standing orders"), linked from
  the topbar nav and the profile dossier. Lists every role grouped by faction
  (reuses `ALL_ROLES` + `FactionTag`), each with a three-state segmented control
  Neutral / Blacklist / Prefer. Blacklist enabled only when `canBlacklistRoles`,
  Prefer only when `canPreferRoles` (locked controls show 🔒 + tooltip); locked
  tiers show a "Bank N reputation to unlock…" hint from `unlocks`. States it is a
  WEIGHTED bias, not a guarantee. Reads GET, writes POST (optimistic, reverts on
  failure). api helpers `fetchPreferences` / `setPreference`; copy in
  `strings-extra.ts` `PREFERENCES`; `.pref-*` CSS (blood accent for an active
  blacklist), mobile-stacked. Server-data-only.

### §5 leak invariant — UNCHANGED and re-proven
- Role assignment is not a leak surface (it produces the per-seat hidden role; §5
  governs who sees it, unchanged). The bot sims exercise init heavily and pass NO
  prefs (guests), so their behavior is byte-identical. Leak sweep
  `NO_DB=1 node packages/bots/dist/cli/leakcheck.js` → **0 leaks / 200 games.**

### Gate (all GREEN; nothing committed, no pm2 restart)
- `pnpm --filter @nocturne/shared build` + `pnpm -r build` clean (5 packages).
  `pnpm -r test`: shared 210, engine **232** (225 + 7 new), client 167, server 91,
  bots 36 — all pass. Determinism property tests pass (same seed+log ⇒ identical
  hash, with and without prefs). `npx eslint .` clean (exit 0). Leak sweep 0/200.

---

## Social — public profiles, friends, DMs, channels, shoutbox, presence

An "older internet site" community layer. **HTTP-only with its own tables** — it
never touches the engine, `transport.ts`/ScopedTransport, the game WS protocol, or
the §5 leak path (leak auditor stays 0/200). Reads of public surfaces (profiles,
rooms, messages) are open; all writes are ACCOUNT-ONLY (guests/anon → 403); a
muted/banned user → 403 (`silenced`) on any post.

### Data + store
- New tables (additive/idempotent in schema.sql): `profiles` (tagline/bio/accent),
  `users.last_seen_at` (presence), `friendships` (one row per unordered pair via a
  `least()/greatest()` unique index, status pending|accepted), `chat_rooms`
  (seeded: shoutbox `The Wire` + channels `The Parlor`/`The Back Room`/`The
  Speakeasy`), `room_messages`, `dm_threads` (canonical user_lo<user_hi), `dm_messages`.
- Full `Store` surface on BOTH impls. MemoryStore seeds the SAME default rooms
  (via `db/default-rooms.ts`) so `/api/rooms` works in NO_DB/CI; route + state-machine
  unit tests run guests-only there.
- The public profile composite reuses `buildUserStatsSummary` + `buildRankedSummary`;
  `friendship` field is computed only for an authed non-guest viewing someone else.

### Routes (all under /api)
`GET users/:username/profile`, `POST me/profile`, `GET me/social`,
`POST friends/request|respond`, `DELETE friends/:id`, `GET rooms`,
`GET/POST rooms/:slug/messages`, `GET/POST dms/:otherUserId`, `POST presence/ping`.
Posts carry a **per-(user, scope) cooldown** (1.2s) keyed by room slug / dm thread —
flooding one stream never blocks a post in another channel or a DM. Presence DB
writes throttled to ≥30s/user; also touched on `GET /api/me`.

### Client
`/community` (masthead + faux visitor counter + The Wire shoutbox + channels +
who's-around, delta-polled ~5s), `/u/:username` (public profile + inline self-edit +
friend actions), `/friends` (friends/requests + DM pane). Usernames link to
`/u/:username` from the leaderboard + dossier. All user text sanitized on render.
Mobile: friend rows wrap their action group rather than clip at the 820px breakpoint.

### Incidental fix (pre-existing race, surfaced during the social screenshot pass)
The WS keepalive `ping` is now exempt from the pre-hello guard in `ws/handlers.ts`.
The client starts pinging the instant the socket opens (right after `hello`) and the
gateway dispatches frames concurrently, so a ping could race ahead of the still-
resolving async hello and draw a spurious "send hello first" error toast on page
load. `ping` only echoes a `pong` with the caller's timestamp (identity-free), so
exempting it is safe; every other command still requires hello.

### Gate (all GREEN)
`pnpm -r build` clean; `pnpm -r test` shared 210 / engine 232 / client 167 /
**server 109** (+18 social) / bots 36; `npx eslint .` exit 0; leak sweep 0/200.
Verified live end-to-end (friend request→reverse-accept, shoutbox post, scoped-
cooldown DM, public profile) + desktop/mobile screenshots, 0 console errors.
