# Adding a Role to Project NOCTURNE

A precise, end-to-end checklist for adding a new role. Roles are data in
`@nocturne/shared`; the engine reads that data and runs the resolution pipeline;
the server/client carry it over the protocol automatically. The client role card
is generated from shared data — you should **not** need to touch the client.

Use TEST MODE (god view + `end_phase` + audit JSON, see the last section) to
validate every new role against the real resolution engine before shipping it.

> Source of truth: the codebase. This doc references real files; when in doubt,
> read them. The MVP role set lives in `packages/shared/src/roles/`.

---

## 0. Decide the role's mechanics first

Pin down, on paper:

- **Faction & win condition** — Town / Mafia / Neutral (benign / killing /
  evil). See `packages/shared/src/types/faction.ts`.
- **Night and/or day ability** — what it does, target scope, uses, immunities.
- **Which of the 9 §6.8 resolution steps it hooks** (jail, roleblock, protect,
  deceive/frame, kill, investigate, deaths, promotions, win) — see
  `packages/engine/src/resolve.ts`.
- **Investigator class** (R1–R8) and **Sheriff alignment** (suspicious /
  not_suspicious) — how it reads to Town investigative roles.

---

## 1. Shared: the role definition file

Create `packages/shared/src/roles/<role>.ts` mirroring an existing one
(`packages/shared/src/roles/sheriff.ts` is a good template). A `RoleDefinition`
(see `packages/shared/src/roles/types.ts`) carries:

- `id` (add to `ROLE_IDS` in `packages/shared/src/types/role.ts`),
- `name`, `faction`, `nightAction`, `dayAction`, `targetScope`, `unique`,
- `nightImmune`, `roleblockImmune`, `visits`,
- `sheriffResult` and `investigatorClass` (the metadata Town reads),
- `tagline`, `description` (ORIGINAL wording — no copied text, §2.1.2/§2.1.3),
- `winHint`.

Then register it:

1. Add the `id` literal to `ROLE_IDS` in
   `packages/shared/src/types/role.ts` (this drives `RoleIdSchema`, so the
   protocol accepts the new role everywhere).
2. Import + add it to the `ROLES` record and the `export { … }` block in
   `packages/shared/src/roles/index.ts`.
3. If it changes how a target reads to investigation, update the class table in
   `packages/shared/src/` (the `INVESTIGATOR_CLASS_TABLE` /
   `FRAMED_INVESTIGATOR_CLASS` constants — see how `resolve.ts` imports them).

The role card (`your_role`) is built from this data by
`packages/engine/src/roleinfo.ts` (`abilityInfoFor` / `yourRoleEffect`); the
client renders it automatically. No client change needed — **verify** by adding
the role to a setup and checking the role card in a test game (§7 below).

---

## 2. Setups: include the role

A role only appears if a setup can roll it. Edit the setups in
`packages/shared/src/setups/` (`classic.ts` / `curated.ts`):

- Add a `fixed` slot for a guaranteed role, or extend a category pool
  (`RANDOM_TOWN`, `RANDOM_MAFIA`, etc.) and the setup's `townPool`.
- Keep `slotsByPlayerCount` valid for every supported count (the setup tests in
  `packages/shared/src/setups/setups.test.ts` enforce structural validity).

For golden testing you do **not** need a public setup — the engine test harness
(`packages/engine/test/harness.ts` `makeGame([...roles])`) builds an exact
seat→role mini-game directly.

---

## 3. Engine: night ability key

If the role has a **night** action, map it in
`packages/engine/src/roleinfo.ts` (`roleToNightAbility`) to a concrete
`NightAbility` key, and add that key to the `NightAbility` union in
`packages/engine/src/state.ts` if it is new. `abilityInfoFor` in the same file
controls the ability descriptor (id/timing/usesRemaining) shown on the card.

Uses/metering constants (bullets, executions, vests) live in
`@nocturne/shared` and are read in `roleinfo.ts` / `resolve.ts`.

---

## 4. Engine: resolution pipeline placement (§6.8)

`packages/engine/src/resolve.ts` runs the night in a fixed 9-step order. Hook
your ability into the **correct** step — order is load-bearing:

1. **Jail** — prisoner shielded; intents removed.
2. **Roleblocks** (fixed point, §6.7) + SK redirect.
3. **Protection** — doctor shields, survivor vests, jail protection.
4. **Deception** — framer marks (affects investigation reads).
5. **Kills** — collected, then resolved simultaneously in fixed source order
   (`KILL_SOURCE_ORDER`). Add a new kill source to that order + the `DeathCause`
   type in `packages/shared/src/types/death.ts`.
6. **Investigations** — reads post-kill state; deaths unknown until dawn. Sheriff
   / investigator / lookout live here (`sheriffRead`, `investigatorRead`).
7. **Deaths** — recorded in report order; `death` traces emitted.
8. **Promotions & bookkeeping** — use decrements, mafia succession,
   executioner→jester conversion, roster refresh.
9. **Win check** — fires from `apply.ts` after resolution (see below).

For a passive/aura role, decide which step its effect must be visible by and
gate it there. Every meaningful outcome should push a `ResolutionTrace` record
(see the `ResolutionTrace` union in `packages/engine/src/state.ts`) — the traces
are the audit trail and golden-test fixture, and they flow to the test-mode god
view as `debug_trace`.

---

## 5. Win-condition interactions

Win logic is in `packages/engine/src/wincheck.ts` (`checkWin`,
`checkStalemate`, `buildGameOver`) and is invoked from
`packages/engine/src/apply.ts` (`runNightResolution`, `startDayVoting`,
`afterExecution`). If your role changes who counts toward parity, who must be
"last standing", or adds a personal/rider win (like Jester/Executioner), update
`wincheck.ts` and the per-seat outcome mapping. Add a `WinCheckReason` if you
introduce a new way the game can end.

---

## 6. Required tests + leak considerations

- **Golden night tests** — add cases to `packages/engine/test/night.test.ts`
  (or a new file) using `makeGame` / `toFirstNight` / `night` /
  `resolveNightPhase` from `packages/engine/test/harness.ts`. Assert seat
  alive/dead, private results, and the exact `ResolutionTrace` records.
- **Win/day tests** — `packages/engine/test/win.test.ts`,
  `packages/engine/test/day.test.ts` if the role affects voting/lynch/win.
- **Property/purity** — the existing `purity.test.ts` / `property.test.ts`
  suites run over all roles; keep `apply` pure (clone, no I/O, PRNG only).
- **Leak auditor** — if the role adds a new role-id string or a new
  secret-bearing frame, update the allowlist/role set in
  `packages/bots/src/leak.ts` (`KNOWN_ROLES`, and the typed entitlement checks).
  Then run the §12.3 leak suite (`packages/bots/src/__tests__/leak.test.ts`):
  20+ seeded games must leak nothing. A new investigation result or private
  notice must be addressed to the entitled seat ONLY.

Gate: `pnpm -r build && pnpm -r test && npx eslint .` must be green.

---

## 7. Validate with TEST MODE (god view + end_phase + audit)

TEST MODE lets the owner watch a full game with full visibility and audit the
engine — ideal for a new role.

1. **Boot with the gate open:**
   `NOCTURNE_TEST_MODE=1 NO_DB=1 node packages/server/dist/index.js`
   (or set the host account admin). A test lobby is forced private and badged
   `TEST` in `lobby_state`.
2. **Create a test lobby** with `create_lobby { config: { testMode: true } }`,
   on a setup that includes the new role.
3. **Backfill bots** so you can run a full game solo:
   `test_control { action: 'add_bot', count: N, policy: 'scripted' | 'llm' }`
   (pre-game). The host is the **god audience**.
4. **As host you receive, in addition to normal play frames:**
   - `debug_state` — every seat's true role/faction/alive/uses/immunity, current
     night intents (who→what→whom), jail/frame/protect marks, mafia roster,
     pending jester-grief, vote tallies, executioner targets. Sent on every
     phase change and on `test_control { action: 'request_state' }`.
   - `debug_trace` — the full `ResolutionTrace` array for each night plus the
     dawn deaths. This is where you verify your role hit the right §6.8 step.
   - `debug_event` — a mirror of every validated GameEvent appended to the log.
5. **Skip the clock** with `test_control { action: 'end_phase' }` to step phase
   by phase without waiting out timers — watch the `debug_trace` after each
   night to confirm your role resolves correctly.
6. **Download the audit** for fixtures/disputes:
   `GET /api/test/match/:roomId/audit` (host or admin; test rooms only) returns
   setup, seed, full action log, all traces, and per-seat private-result
   history. Use it to build a golden test (the seed makes it replayable) or to
   prove an engine outcome.

Wire reference (server): protocol in
`packages/shared/src/protocol/debug.ts`; god-view emission in
`packages/server/src/room/room.ts`; gating + `test_control` in
`packages/server/src/lobby/manager.ts`; bot backfill in
`packages/server/src/bots/manager.ts`; audit route in
`packages/server/src/http/test-routes.ts`.
