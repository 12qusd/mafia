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
