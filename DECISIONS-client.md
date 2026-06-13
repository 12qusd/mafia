# DECISIONS-client.md — TEST MODE god-view client

Decisions made building the client UI for the gated TEST MODE (god-view +
bot backfill + audit). Scope was `packages/client/` only; shared/server/engine/
bots were read but never modified. Companion to the repo-wide `DECISIONS.md`.

---

## roomId for the audit URL (the required workaround)

`GET /api/test/match/:roomId/audit` needs a `roomId`, but **`game_started`
carries no roomId/matchId** (only `game_over` carries `matchId`, and that's
post-game). Rather than add a field to a shared message (out of scope), I
derived it: the server **reuses the lobby id as the room id** —
`packages/server/src/lobby/manager.ts` line ~268: `const roomId = lobby.id; //
reuse the id`. So the audit `:roomId` IS the lobby id.

- The Director "Download audit" button uses `state.lobby.id` as the roomId
  (`lib/api.ts#downloadAudit`, called from `DirectorPanel`).
- The button is enabled only when the local client is the lobby **host**
  (`isHost`); a non-host god (e.g. a host spectating without host transfer)
  gets the button disabled, since the audit route is host/admin-only.
- If the lobby object is gone from the store at the moment of click, the button
  is disabled (no roomId), rather than guessing.

## Visibility gate (no regression to normal play)

The Director panel renders **only** when `store.debug.state !== null`. Normal,
non-test, non-god clients never receive `debug_*` frames (the server emits them
to the test-lobby host audience only, and the bots leak auditor asserts this),
so `debug.state` stays null and `<DirectorGate>` returns `null`. A vitest test
asserts hidden-with-no-state / shown-with-a-state.

## Store shape & buffers

- `store.debug = { state, traces[], events[] }`.
- `debug_state` → keep latest snapshot.
- `debug_trace` → appended, **de-duped by `nightNumber`** so a
  `request_state`-driven resend (or a repeat) never doubles a night's trace.
  Rendered newest-night-first, each night collapsible.
- `debug_event` → ring buffer capped at `DEBUG_EVENT_CAP = 500` (newest kept).
- The god-view is reset on `game_started`, `resetGame`, and `resetAll` (a fresh
  match starts with an empty god-view).
- No new inbound plumbing was needed: the shared `ServerMessageSchema` already
  includes the three debug schemas, so `safeParseServerMessage` validates them
  in the existing WS layer and they flow to the pure `reduce` like any frame.

## test_control errors

`not_host` / `forbidden` / `wrong_phase` / `not_in_game` are already members of
the shared `ErrorCode` set with copy in `strings.ERROR_TEXT`, and the server
returns them as ordinary `error` frames. They therefore surface through the
existing toast path automatically — no new error handling was added.

## Bot add/remove gating (pre-game)

`add_bot` / `remove_bot` are pre-game only. The client treats `ASSIGN` and
`DAY_0` (from `debug_state.phase`) as the pre-game window and disables the bot
controls otherwise; the server remains authoritative (rejects with
`wrong_phase`, surfaced as a toast).

## Test lobby creation & forced-private

The "Test mode" toggle in the create-lobby card sends
`create_lobby { config: { testMode: true } }`. Test lobbies are **forced
private** client-side (the visibility select is locked to private while the
toggle is on), matching the server. If the server's env/admin gate is closed it
rejects with an `error` (surfaced as a toast); the client attempts it
regardless, as instructed.

## TEST badge

Shown via `<TestBadge>` wherever `testMode` is true: the lobby header
(`LobbyScreen`), the create-lobby toggle, in-game (`GameScreen` top), and — if
the server ever lists a test lobby in the public browser — the lobby-row in
`HomeScreen` (test lobbies are forced private and normally excluded, so this is
defensive; `lib/api.ts` narrows an optional `testMode`).

## Client-local copy

All god-view copy lives in `lib/strings-extra.ts` (`DIRECTOR`,
`TRACE_STEP_LABEL`, `DEATH_CAUSE_LABEL`, and `HOME.testModeLabel/Hint`), per the
existing convention that `@nocturne/shared/strings` is not edited by the client
agent. The Director copy is intentionally plainer (a dev/QA tool) than the
in-fiction game copy.

## Ergonomics

- Trace viewer groups each record by its §6.8 step (`TRACE_STEP_LABEL`) and
  renders a one-line human summary (`describeTrace`), so kill/protect/block/
  frame/investigate interactions and resulting deaths are readable by eye —
  enough to validate a new role per `docs/ADDING_ROLES.md`.
- Keyboard: **Shift+E** ends the current phase from anywhere in-game (ignored
  while typing in an input/textarea). The End Phase button shows the hotkey.
- The panel is a fixed, collapsible bottom-right overlay with tabbed sections
  (Live board / Night intents / Votes / Resolution traces / Event log /
  Controls), so it never disrupts the normal three-column game layout.
