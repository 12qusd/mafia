# Project NOCTURNE — Build Specification v1.0

A standalone online social-deduction game (Mafia/Werewolf genre, mechanically descended from the
StarCraft II Arcade map "SC2Mafia" and its commercial descendant Town of Salem). Web-first, with a
later Electron + Steam desktop SKU.

This document is self-contained: an implementing agent should be able to build the MVP from this
spec alone, without access to the research that produced it. Where this spec is silent, prefer the
simplest deterministic rule, document the decision in `DECISIONS.md` at the repo root, and keep
going — do not block.

> **Codename note:** "NOCTURNE" is a working codename. The shipping name requires a trademark
> sweep (see §3). Do not hardcode the codename into user-facing strings; use a single
> `GAME_NAME` constant.

---

## 1. Product overview

### 1.1 What the game is

7–15 players join a lobby. Each is secretly assigned a role belonging to a faction:

- **Town** (uninformed majority) — wins by eliminating all evil players.
- **Mafia** (informed minority with a private night chat) — wins at parity with the rest.
- **Neutrals** (independent win conditions) — e.g. a Serial Killer who must be the last killer
  standing, a Jester who wins by getting himself lynched.

The game alternates **Night** (everyone secretly submits role actions; Mafia coordinates a kill in
private chat) and **Day** (deaths are announced, everyone argues in public chat, and the town votes
to put someone on trial and possibly execute them). Repeat until a win condition is met. A full
game runs 20–45 minutes.

The product is ~90% UI (chat log, player list, vote buttons, timers) plus an authoritative
server. There is no real-time movement, physics, or twitch gameplay.

### 1.2 Product priorities (ordered)

1. **Trustworthy rules engine** — in a deduction game, a wrong investigation result is
   indistinguishable from a rigged server. Determinism, auditability, and test coverage of the
   night-resolution engine outrank every feature.
2. **Information security** — a client must never receive data its seat is not entitled to.
   This is an architectural invariant, not a feature (§5).
3. **Private, bring-your-own-group lobbies as the first-class mode** — the genre dies by
   population spiral; friend groups are immune to it. Public matchmaking is secondary.
4. **Solo-operability** — one person runs this. Boring technology, one VPS, automated tests
   that replace human playtesters wherever possible.

### 1.3 Release sequencing (context for scope decisions)

- **Phase A (this spec's MVP):** free browser game, private lobbies + simple public lobby list,
  15 roles, 3 curated setups, accounts optional (guest play allowed in private lobbies).
- **Phase B:** Steam SKU via Electron (§14), Steam auth, achievements. Only after Phase A has a
  living population.
- Explicitly **deferred** (do not build, but do not preclude): ranked/ratings, the full
  host setup editor with per-role option toggles, conversion factions (Cult), second evil faction
  (Triad), voice chat, mobile, localization beyond string externalization.

---

## 2. Hard constraints

### 2.1 Legal / content constraints (binding on all code and assets)

Game **mechanics** are intentionally derived from the SC2Mafia/Town of Salem lineage — mechanics
are not protectable and the genre ships on this basis. Everything **expressive** must be original:

1. **No StarCraft/Blizzard assets or references of any kind** — no models, sounds, icons, fonts,
   names, or marketing references ("as seen in StarCraft II" is forbidden).
2. **All player-facing text must be written fresh for this project**: role descriptions,
   investigation result strings, announcements, tutorial text, flavor. Never paste text from the
   SC2Mafia wiki, Town of Salem, or any other game. Mechanical *facts* (e.g. "the Doctor prevents
   one kill") are fine; their wording must be ours.
3. **Generic role names are safe** (Sheriff, Doctor, Investigator, Lookout, Escort, Jailor,
   Vigilante, Mayor, Citizen, Godfather, Mafioso, Consort, Framer, Serial Killer, Jester,
   Executioner, Survivor — dictionary words / real mafia terminology). Distinctive coined names
   from the source games (e.g. "Beguiler", "Auditor", "Crier", "Marshall") must NOT be used.
4. **Visual identity must be original** and visually distant from both StarCraft and Town of
   Salem's colonial-Salem trade dress. Theme direction is open (suggested: 1920s
   noir/Prohibition); pick one and record it in `DECISIONS.md`.
5. The repo must contain `CLEANROOM.md` logging the sources consulted (this spec only, plus any
   public rules references by URL) — contemporaneous documentation of the clean-room process.

### 2.2 Engineering constraints

- **TypeScript everywhere.** One language across engine, server, client, bots.
- **The game engine is a pure, deterministic library** with zero I/O (§6). Same inputs (setup,
  seed, action log) ⇒ same outputs, byte-for-byte. All randomness flows from one seeded PRNG.
- **Server-authoritative, whitelist-by-default messaging** (§5). No framework "state sync" may
  carry secret data; secrets travel only in explicitly addressed per-client messages.
- **Postgres** is the only database. In-flight game state lives in process memory; the DB is
  written at match end (plus moderation events). No DB calls in the per-message hot path.
- **No paid services** in Phase A beyond one VPS and a domain.

---

## 3. Naming & theming checklist (pre-launch, non-code)

- Title must not contain "SC2", "StarCraft", or be a bare "Mafia" (Take-Two holds "Mafia"
  video-game marks). Run a trademark search before committing.
- Do not use "Town of Salem" except nominatively in private notes; never in marketing.
- Keep `GAME_NAME`, logo, and palette swappable.

---

## 4. Architecture & repository layout

### 4.1 Monorepo

```
nocturne/
  package.json            # pnpm workspaces
  DECISIONS.md            # running log of spec-silent decisions made by implementers
  CLEANROOM.md            # sources log (see §2.1.5)
  packages/
    shared/               # protocol types, zod schemas, constants, enums. No logic.
    engine/               # pure game engine. Depends only on shared. No I/O, no Date.now,
                          # no Math.random — seeded PRNG and clock are injected.
    server/               # Node: WebSocket gateway, room manager, lobby/auth HTTP API,
                          # persistence, moderation. Depends on shared + engine.
    client/               # React + Vite SPA. Depends on shared only.
    bots/                 # headless bot clients + simulator CLI. Depends on shared + engine.
  apps/
    desktop/              # Phase B Electron wrapper. Empty placeholder in Phase A.
```

- **pnpm** workspaces; **zod** for all message validation; **ws** on the server,
  native `WebSocket` in clients. Vitest for tests. ESLint + Prettier, strict tsconfig.
- The client and bots speak the identical protocol; bots are the reference client.

### 4.2 Server processes (Phase A: one Node process is fine)

- **Gateway/Rooms**: WebSocket endpoint `/ws`. Owns lobby objects and in-game Room instances.
  A Room wraps one engine instance plus per-seat connection state.
- **HTTP API** (same process, Fastify or Express): account signup/login, lobby list, health.
- **Postgres** via `pg` or Drizzle (implementer's choice; record in DECISIONS.md).
- Deployment target: single Linux VPS behind Caddy (TLS) with Cloudflare in front. systemd unit.
  Graceful deploy: SIGTERM ⇒ stop accepting new lobbies, let running games finish (max 60 min),
  then exit (§13.4).

### 4.3 Determinism & event sourcing

Every match records:

- the **setup** (player count, role list, config),
- the **seed** (server-generated, secret until match end),
- the **ordered action log** (every validated client command + server-scheduled phase event).

Replaying (setup, seed, log) through the engine reproduces the entire match exactly. This is the
basis of: regression tests, bug reports, post-game replays, and moderation evidence. The engine
must never read wall-clock time or unseeded randomness (enforce by lint rule in `packages/engine`).

---

## 5. Information-security model (the prime invariant)

**INVARIANT: a byte sent to client C may contain only information seat(C) is entitled to at that
moment under the game rules.**

Entitlements:

| Data | Who may receive it |
|---|---|
| Own role, own action results | that seat only |
| Public state: seat list, alive flags, phase, timers, vote tallies (open voting), trial state, day chat, death announcements, revealed roles & last wills of the dead | all clients incl. spectators |
| Mafia night chat, mafia kill-target votes, identities of fellow mafiosi | mafia-member seats only |
| Jail chat | jailor + prisoner only (jailor identity masked as "Jailor") |
| Whisper content | sender + recipient (metadata "X whispers to Y" is public) |
| Dead chat | dead seats only |
| All hidden info (all roles, all actions, mafia chat, etc.) | dead seats, ONLY if config `deadSeeAll=true` (default in private lobbies; `false` in public lobbies, where the dead see dead chat + public info only) |
| Full game state + seed | everyone, after `game_over` |

Implementation rules:

1. There is **no broadcast game-state object containing roles or actions**. The server composes
   messages per recipient. A helper `sendTo(seatIds[], msg)` and `broadcastPublic(msg)` are the
   only send paths; direct socket writes are forbidden by convention and lint.
2. Role assignment is sent to each client individually (`your_role`). The mafia roster is sent
   only to mafia members.
3. Vote tallies during open voting are public by design (that's the game). Trial verdict votes
   are revealed per-voter after judgment (public), per classic rules.
4. **Leak-detector test harness is mandatory** (§12.3): simulated games run with full per-client
   traffic capture, and an assertion sweep proves no client received another seat's secrets
   before legal reveal. CI fails on any leak.
5. Server validates every command against (seat alive? phase correct? role has this ability?
   target legal? rate limit ok?). Invalid commands get an `error` reply and are not logged to the
   action log.

---

## 6. Game engine specification

`packages/engine` exports a pure state machine:

```ts
type Engine = {
  init(setup: GameSetup, seed: string): GameState;
  // Applies one event; returns new state + per-recipient effects. Pure.
  apply(state: GameState, event: GameEvent): { state: GameState; effects: Effect[] };
  // Convenience: what the server schedules next (phase deadline).
  nextDeadline(state: GameState): { phase: Phase; endsAt: GameTick } | null;
};
```

`GameEvent` is either a validated player command (`{type:'vote', seat, target}`,
`{type:'night_action', seat, ability, target}`, `{type:'chat', ...}` …) or a server event
(`{type:'phase_end'}`, `{type:'seat_disconnected'}` …). `Effect` is an addressed outbound message:
`{to: 'public' | 'dead' | 'mafia' | SeatId[], msg: ServerMessage}` — the server transport layer
delivers effects verbatim; **all entitlement logic lives in the engine**, in one place.

### 6.1 Phase state machine

```
LOBBY ──start──▶ ASSIGN ─▶ DAY_0 (discussion only, no voting)
                              │
        ┌──────────◀──────────┘
        ▼
      NIGHT ─▶ DAWN (reveal deaths) ─▶ DAY_DISCUSSION ─▶ DAY_VOTING ─┬─(majority on X)─▶ TRIAL_DEFENSE ─▶ TRIAL_JUDGMENT ─┬─guilty─▶ EXECUTION ─▶ (win check) ─▶ NIGHT
        ▲                                                            │                                                    └─innocent/tie─▶ DAY_VOTING (timer resumes)
        └────────────────(no lynch by day end; win check)────────────┘
```

- Win conditions are evaluated: after EXECUTION, at the end of NIGHT resolution (before DAWN
  announcements are emitted — i.e. dawn deaths can end the game), and at the start of each
  DAY_VOTING (for parity/auto-resolve).
- `DAY_0`: game starts on a no-lynch day (discussion only) so Town gets one social phase before
  the first night. Config `firstPhase` exists but MVP ships only `day_no_lynch`.

### 6.2 Default timings (config-overridable per lobby within [min,max])

| Phase | Default | Min | Max |
|---|---|---|---|
| DAY_0 | 45 s | 15 | 120 |
| NIGHT | 60 s | 30 | 120 |
| DAWN (death reveals, paced) | 8 s + 4 s/death | fixed | fixed |
| DAY_DISCUSSION | 45 s | 0 | 180 |
| DAY_VOTING | 150 s | 60 | 360 |
| TRIAL_DEFENSE | 25 s | 15 | 60 |
| TRIAL_JUDGMENT | 25 s | 15 | 60 |
| EXECUTION (last words + reveal) | 12 s | fixed | fixed |

- The trial **pauses** the DAY_VOTING timer; on an innocent verdict the timer resumes where it
  paused. Max **3 trials per day**; after the third innocent verdict the day ends immediately.
- Night actions may be changed freely until the NIGHT deadline; last submission wins.
- Server accepts commands up to **250 ms** after a phase deadline (network grace), then the
  phase-end event is appended and later packets for that phase are rejected.
- Clients render countdowns from `phase_change.endsAt` (server epoch ms) corrected by a
  client-server clock offset estimated from the WS handshake; the server never trusts client
  clocks.

### 6.3 Voting & trials

- **Nomination voting (DAY_VOTING):** each living seat may vote one living seat (or no one);
  votes are public and changeable. A seat reaching **floor(livingVoteWeight/2)+1** weighted votes
  is immediately put on trial. (Vote weight is 1; a revealed Mayor's is 3.)
- **Trial:** the accused may talk during TRIAL_DEFENSE (everyone else may too — chat is not
  restricted in MVP). During TRIAL_JUDGMENT every other living seat votes guilty / innocent /
  abstain (private while voting). Guilty > innocent (weighted) ⇒ execution; ties or fewer ⇒
  innocent. After judgment, each voter's verdict is revealed publicly.
- **Execution:** the condemned may speak during EXECUTION; then dies; their role and last will
  are revealed; win check runs.
- **Skip-day:** a "skip" vote option; if weighted majority of living seats vote skip, the day
  ends immediately.

### 6.4 Chat channels

| Channel | When | Members |
|---|---|---|
| `lobby` | LOBBY | everyone in lobby |
| `day` | all day phases | living seats write; everyone reads |
| `mafia` | NIGHT | living mafia seats |
| `jail` | NIGHT, if jailed | jailor (masked as "Jailor") + prisoner |
| `dead` | always after death | dead seats |
| `whisper` | day phases | sender → recipient; public metadata event "X whispers to Y" |

- Whispers: config `whispersEnabled` (default true). Max 256 chars. Blackmail-type muting is out
  of MVP scope (no Blackmailer role yet).
- **Last will:** each seat has an editable will (≤ 500 chars), editable any time while alive,
  revealed on death. Config `lastWillsEnabled` default true.
- **Death note:** the Serial Killer and the Mafia (whoever performs the faction kill) may each
  maintain a death note (≤ 256 chars) attached to their victims' death announcements.
- All chat is rate-limited server-side: max 5 messages / 10 s / seat in a channel, 1 whisper / 3 s.

### 6.5 Roles — MVP set (15)

General notions:

- **Visit:** performing a night action on another seat = visiting them (the Lookout sees it).
  Blocked or jailed actors do not visit. Self-targets and passive abilities are not visits.
- **Night-immune:** survives normal night kills (not Jailor executions).
- **Roleblock-immune:** cannot be blocked by Escort/Consort (jail still blocks everyone).
- Every role's full player-facing description ships in `packages/shared/src/roles/*.ts` with
  ORIGINAL text (see §2.1.2).

| # | Role | Faction | Night ability | Notes |
|---|---|---|---|---|
| 1 | Citizen | Town | none | Vanilla. Exists to make claims contestable. |
| 2 | Sheriff | Town | Check one player → "suspicious" / "not suspicious" | Mafioso, Serial Killer, Framed targets ⇒ suspicious. Godfather ⇒ not suspicious. All Town, Jester, Executioner, Survivor, Consort(!) ⇒ … see alignment table §6.6. |
| 3 | Investigator | Town | Check one player → result class (§6.6 table) | Fuzzier than Sheriff; cross-checks claims. |
| 4 | Lookout | Town | Watch one player → list of seats who visited them that night | Sees final, post-block visits. |
| 5 | Doctor | Town | Protect one player → absorbs one lethal attack that night | May self-target once per game. Doesn't stop Jailor executions. |
| 6 | Escort | Town | Roleblock one player | §6.7 block semantics. Visiting the SK gets the Escort killed (§6.7). |
| 7 | Jailor | Town | Day: select a target to jail. Night: target is jailed (blocked + protected + jail chat). May execute the prisoner (2 executions/game) | Execution pierces immunity and heals; cannot jail on Day 0; jail overrides everything (§6.8 step 1). Unique. |
| 8 | Vigilante | Town | Shoot one player (2 bullets/game) | Cannot shoot Night 1. |
| 9 | Mayor | Town | none; Day: one-time public reveal → vote weight becomes 3 | Unique. After reveal, may no longer be healed by the Doctor (classic risk trade). |
| 10 | Godfather | Mafia | Orders the mafia kill (final say) | Night-immune, roleblock-immune, Sheriff reads "not suspicious". Does not visit unless personally performing the kill (no Mafioso alive). Unique. |
| 11 | Mafioso | Mafia | Performs the mafia kill chosen in mafia chat | Promoted from nothing: if Godfather dies and no Mafioso lives, the senior remaining mafia member becomes Mafioso the next night (MVP: Consort/Framer convert to Mafioso — record in DECISIONS.md). Blockable. |
| 12 | Consort | Mafia | Roleblock one player | Mirror of Escort; same SK hazard. |
| 13 | Framer | Mafia | Frame one player for the night | Framed target: Sheriff ⇒ "suspicious", Investigator ⇒ result class containing Mafioso. Frame lasts one night only. |
| 14 | Serial Killer | Neutral-Killing | Kill one player every night | Night-immune. Roleblock-immune in effect: anyone who roleblocks the SK becomes the SK's victim that night instead of the SK's chosen target. Wins by being the last killing party. |
| 15 | Jester | Neutral-Benign | none | Wins (personally) if lynched. The night after a Jester lynch, one randomly chosen guilty-voter dies to grief (unhealable, unpreventable). Game continues. |

**Flex roles for variety (implement; used by setups):**

| # | Role | Faction | Ability |
|---|---|---|---|
| 16 | Executioner | Neutral-Benign | Assigned one random Town target at start (never the Jailor — avoids degenerate claim-checks; record exclusions in DECISIONS.md). Wins (personally) if target is lynched while Executioner lives. If target dies at night, Executioner becomes a Jester. Night-immune. |
| 17 | Survivor | Neutral-Benign | Four one-night vests (night-immunity when used). Wins (personally) by being alive at game end, alongside whoever wins. |

### 6.6 Investigation result classes (original mapping — flavor text TBD, mechanics fixed)

Sheriff alignment table: suspicious = {Mafioso, Consort, Framer, Serial Killer, framed-anyone};
not suspicious = everyone else (incl. Godfather, Jester, Executioner, Survivor).

Investigator result classes (each class deliberately mixes Town with non-Town):

| Class | Roles |
|---|---|
| R1 | Citizen, Survivor, Executioner |
| R2 | Sheriff, Jailor |
| R3 | Investigator, Jester |
| R4 | Doctor, Serial Killer |
| R5 | Escort, Consort |
| R6 | Vigilante, Mafioso, (framed targets report here) |
| R7 | Godfather, Mayor |
| R8 | Framer, Lookout |

### 6.7 Roleblock semantics

- A blocked seat's night action is cancelled; they are notified ("you were distracted") at dawn.
  They do not visit.
- Roleblock-immune (Godfather): block fails; blocker is told "your target could not be
  distracted" (still counts as a visit to the target).
- **Serial Killer hazard:** blocking the SK redirects the SK's kill onto the blocker (blocker is
  told nothing extra; they're dead). The SK's original target survives. SK is otherwise treated
  as roleblock-immune.
- **Blocker-vs-blocker resolution (deterministic fixed point):** build the directed graph of
  block intents. Iterate: a block whose blocker is jailed is removed; then repeatedly mark a
  block "inactive" if its blocker is the target of an *active* block, until no change. Pure
  cycles (A blocks B, B blocks A) stabilize with both blocks **active** — both seats are blocked.
  This replaces SC2Mafia's "repeat a random number of times" with a documented deterministic
  rule. The fixed point is unique; add a property test for it.

### 6.8 Night resolution pipeline (THE critical algorithm)

At NIGHT phase end, the engine resolves all submitted intents in this exact order. Each step
operates on the output of the previous one. Everything is pure; the only randomness is the
injected PRNG (used for: choosing which guilty voter a Jester takes, random tie choices
explicitly noted here — nothing else).

```
INPUT: intents[] = validated (seat, ability, target) — last submission per seat
 0. Remove intents of dead/AFK seats (safety; should not occur).
 1. JAIL: if the Jailor jailed T: remove T's intent; mark T jailed.
    All later actions targeting T fail (their actors are told "your target was unreachable")
    EXCEPT the Jailor execution. Jailed seats neither visit nor can be visited.
 2. ROLEBLOCKS: resolve per §6.7 fixed point. Cancel blocked seats' other intents.
    Apply the SK-kills-blocker retarget here.
 3. PROTECTION: record Doctor shields and Survivor vests on their targets (Doctor visit happens
    even if target is later unhurt). Jailed prisoner gains jail protection.
 4. DECEPTION: apply Framer marks.
 5. KILLS — collected then resolved simultaneously against the state after steps 1–4:
      kill sources in fixed report order: jailor_execute, vigilante, mafia, serial_killer,
      jester_grief (scheduled from a previous day).
      For each kill on target T:
        a. T jailed and source ≠ jailor_execute → fail ("target unreachable").
        b. source pierces (jailor_execute, jester_grief) → T dies. (Heals/immunity ignored.)
        c. T night-immune (Godfather, SK, Executioner, active vest) → fail ("target fought off
           the attack"; T is told they were attacked).
        d. Doctor shield on T absorbs exactly one successful kill (T told "you were attacked but
           nursed back"; attacker told nothing). Additional simultaneous kills still land.
      Killers who themselves die this night still complete their kills (simultaneity rule:
      "dead men's knives still land").
 6. INVESTIGATIONS (see post-kill state; a Sheriff checking a victim still gets a result —
    deaths are not known until dawn):
      sheriff_check, investigator_check per §6.6 (framed status from step 4),
      lookout_watch = list of seats whose intents survived steps 1–2 and targeted X
      (kills, heals, blocks, frames, checks all count; the mafia kill visit is attributed to its
      performer, not the voters).
 7. Compose DAWN report: deaths in the fixed order from step 5, each with role reveal + last
    will + (if killer wrote one) death note. Deliver private results (check results, "you were
    attacked", "you were distracted") to individual seats.
 8. Promotions & bookkeeping: mafia succession (§6.5 #11), Executioner→Jester conversion if
    target died at night, decrement jailor executions / vigilante bullets / survivor vests used.
 9. WIN CHECK (§6.9). If game over, skip DAWN pacing and go to GAME_OVER with full reveal.
```

Every step emits structured trace records (`ResolutionTrace[]`) persisted with the match — the
audit trail for disputes and the fixture for golden tests.

### 6.9 Win conditions & endgame

Evaluated as: (let L = living seats)

1. **Town wins** if no living Mafia and no living Serial Killer.
2. **Mafia wins** if mafiaCount ≥ (L − mafiaCount) and no living Serial Killer.
3. **Serial Killer wins** if SK alive and L == {SK} ∪ (Neutral-Benign seats) — i.e. all Town and
   Mafia are dead. Two SKs cannot co-win (only one SK per setup in MVP anyway).
4. **1v1 auto-resolve** at the start of any DAY_VOTING: if exactly two non-Benign parties remain
   alive and neither can mechanically beat the other, resolve by priority SK > Mafia > Town.
   Concretely in MVP: SK vs one Mafia ⇒ SK wins; SK vs one Town ⇒ SK wins (SK is night-immune
   and Town can't lynch alone — actually a lone Town + SK ⇒ SK wins is correct: town can't get
   a majority against a tie. Implement as the priority rule).
5. **Riders:** at game end, Survivor wins if alive; Jester/Executioner personal wins are awarded
   at the moment of their lynch event regardless of the final faction outcome (they are
   announced at game end).
6. **Stalemate guard:** if 3 consecutive Nights produce zero deaths, the game ends immediately:
   the largest living faction wins (Town vs Mafia by count; tie ⇒ Mafia, classic parity rule;
   SK counts as a faction of 1 and wins ties over Mafia).

`game_over` reveals: every seat's role, the full action log summary, the seed, and per-seat
win/loss.

### 6.10 Setups (role lists per player count)

Setups are data (`packages/shared/src/setups/*.ts`). A setup = ordered slot list; each slot is a
fixed role or a category pool. Categories for MVP: `RANDOM_TOWN` (any Town role from the setup's
allowlist), `RANDOM_MAFIA` (Consort | Framer). Constraint solver: unique roles (Jailor, Mayor,
Godfather) max once; assignments drawn with the match PRNG.

Default auto-scaling setup ("Classic Nocturne"):

| Players | Town | Mafia | Neutral | Composition |
|---|---|---|---|---|
| 7 | 4 | 2 | 1 | Sheriff, Doctor, Jailor, Citizen \| Godfather, Mafioso \| Jester |
| 8 | 5 | 2 | 1 | + Escort |
| 9 | 6 | 2 | 1 | + Vigilante |
| 10 | 6 | 2 | 2 | + Serial Killer |
| 11 | 7 | 2 | 2 | + Investigator |
| 12 | 7 | 3 | 2 | + RANDOM_MAFIA |
| 13 | 8 | 3 | 2 | + Lookout |
| 14 | 8 | 3 | 3 | + Executioner |
| 15 | 9 | 3 | 3 | + Mayor |

Plus two more curated 15p setups for variety (implementer designs them from the same role pool;
record in DECISIONS.md). Lobbies pick a setup; the host may not edit slots in MVP (the full
editor is deferred).

---

## 7. Lobby & session flow

1. **Identity:** Phase A supports (a) guest sessions (random display name, cookie token; allowed
   in private lobbies only) and (b) registered accounts (username + password, argon2id; email
   optional). One session token (httpOnly cookie for HTTP, passed once over WS hello).
2. **Lobby creation:** any logged-in user creates a lobby: name, public/private, invite code
   (6-char, private lobbies), setup choice, config overrides (timings within bounds,
   whispers on/off, `deadSeeAll`). Creator = host.
3. **Lobby list:** public lobbies visible in a browser (name, players/capacity, setup, status).
   Private lobbies joinable by code/link only.
4. **Host powers:** kick (pre-game only), transfer host, start game (when player count within
   the setup's range and ≥ 7). Host disconnect in lobby ⇒ host migrates to longest-seated player.
5. **Start:** server locks the roster, creates the Room, generates the seed, assigns roles via
   engine `init`, sends each seat `your_role` (+ mafia roster to mafia).
6. **In-game disconnect/reconnect:** §8.
7. **Game end:** results screen; players flow back to a fresh lobby with the same roster
   ("play again" keeps the group together — important for the BYO-group strategy).
8. **Spectators:** users may join a lobby as spectators (public state + day chat read-only;
   never any secret, regardless of `deadSeeAll`). Cap 20 per room.

---

## 8. Reconnection, AFK, leavers

- Seats are bound to account/guest identity, not sockets. On disconnect mid-game: seat marked
  `disconnected`, public indicator shown, **game never pauses**.
- Resume: client presents its session token; server re-attaches the socket to the seat and sends
  a complete **per-seat filtered snapshot**: public state, own role + private-knowledge log
  (every private result they've received), chat backlog for channels they're entitled to
  (cap: last 200 messages/channel), current phase + deadline.
- Duplicate connection for the same identity: newest socket wins; old one is closed.
- Absence semantics: disconnected/AFK seats vote nothing (abstain), submit no night action;
  for the Mafia kill the remaining mafia choose. An AFK Jailor simply doesn't jail.
- AFK detection: no command for 2 consecutive phases ⇒ flagged AFK (public indicator). No
  auto-kill, no bot takeover in MVP.
- Leaving (explicit "leave game") = permanent: seat suicides at the next night resolution
  (counts as an unpreventable death, role revealed; any queued kill they had still lands per
  simultaneity). Log leaver events per account for future penalties; no penalties in MVP.
- Server crash: in-flight games are lost; on restart, affected matches are recorded
  `abandoned`. (Snapshot/rehydrate is deferred; the event log makes it possible later.)

---

## 9. Network protocol

WebSocket, JSON text frames, zod-validated both directions. Every message:
`{v: 1, type: string, ...payload}`. Server rejects unknown `type` or failed validation with
`{type:'error', code, detail?}` and never crashes on malformed input (fuzz test required).

### 9.1 Client → server (complete MVP catalog)

```
hello            {token?, protocolVersion}        // first message; server replies welcome|error
create_lobby     {name, visibility, setupId, config?}
join_lobby       {lobbyId | inviteCode, asSpectator?}
leave_lobby      {}
lobby_config     {config}                          // host only
kick             {seatOrUserId}                    // host, pre-game
start_game       {}
chat             {channel, text}
whisper          {toSeat, text}
vote             {target: SeatId | 'skip' | null}  // null = retract
verdict          {value: 'guilty'|'innocent'|'abstain'}
night_action     {ability, target: SeatId | null}  // null = cancel
day_ability      {ability, target?}                // jailor select, mayor reveal
last_will        {text}
death_note       {text}
report_player    {seat, category, comment?}
ping             {t}
```

### 9.2 Server → client (complete MVP catalog)

```
welcome          {userId?, guestId?, resume?: SeatSnapshot}
lobby_state      {lobby}                           // full lobby object (pre-game, public data)
game_started     {seats: PublicSeat[], setupId, config}
your_role        {role, faction, abilities, mates?: SeatId[]}   // mates only for mafia
phase_change     {phase, dayNumber, endsAt}
chat_message     {channel, fromSeat|'Jailor', text, ts}
whisper_meta     {fromSeat, toSeat}                // public
whisper          {fromSeat, text}                  // to recipient only
vote_update      {tallies: {seat: weight}[], votesBySeat}
trial_start      {accusedSeat}
verdict_result   {accusedSeat, outcome, votes: {seat, value}[]}
death_announce   {seat, role, lastWill?, deathNote?, cause}
private_result   {kind, ...}                       // check results, attacked, distracted, etc.
day_ability_ack  {ability, target}
game_over        {winners, allRoles, seed, matchId}
seat_status      {seat, connected, afk}
error            {code, detail?}
pong             {t}
force_update     {minProtocolVersion}              // client must refresh
```

`SeatSnapshot` (resume) = everything in §8. All payload schemas live in `packages/shared` as the
single source of truth; server and client import the same zod objects.

---

## 10. Persistence (Postgres)

```sql
users            (id uuid pk, username citext unique, email citext null,
                  password_hash text, created_at, last_login_at, flags int)
sessions         (token_hash pk, user_id fk, expires_at, revoked bool)
matches          (id uuid pk, setup_id text, config jsonb, seed text,
                  started_at, ended_at, outcome text, server_build text)
match_players    (match_id fk, user_or_guest_id, seat int, role text, faction text,
                  outcome text,           -- win | loss | draw | left
                  survived bool, pk(match_id, seat))
match_events     (match_id fk, seq int, phase text, event jsonb, pk(match_id, seq))
                  -- the full action log + resolution traces; append-only, written at match end
chat_messages    (match_id, seq, channel, sender_seat, body, created_at)
                  PARTITION BY RANGE (created_at)   -- weekly; retention = DROP PARTITION (90d)
reports          (id pk, reporter, target_user, match_id, category, comment,
                  evidence jsonb,         -- chat excerpt auto-attached server-side at report time
                  created_at, status, reviewed_by)
sanctions        (id pk, user_id, type,   -- warning|mute|temp_ban|perma_ban
                  reason, report_id null, issued_by, starts_at, expires_at null)
```

- Ban/mute check: one indexed query at login and lobby-join.
- GDPR posture: minimal PII (email optional); account deletion pseudonymizes the users row and
  keeps match rows keyed to the opaque id; chat partitions auto-drop at 90 days except excerpts
  attached to open reports. Don't log IPs alongside chat (security log only, 30-day retention).
- No ratings tables in MVP (the event log makes ratings recomputable later).

---

## 11. Moderation & safety (MVP bar)

1. **Report flow** (§9 `report_player`): server snapshots the relevant chat context into the
   report row at submission time. Categories: harassment, hate, spam, gamethrowing, cheating.
   Dedupe per (target, match).
2. **Player mutes:** client-side mute that is server-enforced (muted sender's messages are not
   delivered to that recipient, including whispers). Persisted per account.
3. **Sanctions:** admin-applied ladder (warning → timed mute → temp ban → perma ban) via a
   minimal internal admin page (HTTP, admin flag on users; every admin action logged).
4. **Profanity filter:** server-side normalizing wordlist filter (e.g. `obscenity` npm),
   client-toggleable display; never auto-bans.
5. **Rate limits** per §6.4 + connection-level (max 20 msgs/10 s per socket).
6. Sanitize all rendered text (chat, names, wills, notes): plain text only, no HTML/markdown
   rendering, length caps, strip control chars. XSS tests required.

---

## 12. Testing requirements (CI-gating)

### 12.1 Engine unit + property tests

- Golden-case suite for the resolution pipeline: at minimum these scenarios, each asserting the
  full ResolutionTrace —
  jail blocks RB-immune; jailor-execute pierces doctor heal; two simultaneous kills overwhelm one
  heal; SK kills his blocker (Escort and Consort variants); blocker-cycle fixed point (A↔B);
  blocker chain (A blocks B blocks C ⇒ C acts? no: B blocked ⇒ C unblocked — assert);
  framed citizen reads suspicious to Sheriff and R6 to Investigator while frame expires next
  night; Godfather reads not-suspicious; dead vigilante's queued shot still lands; Doctor
  self-heal; Mayor reveal then unhealable; Jester lynch ⇒ random guilty voter dies unhealably;
  Executioner target night-death ⇒ becomes Jester; mafia succession after GF+Mafioso both die;
  win-check: parity, SK-vs-lone-mafia, 3-quiet-nights stalemate.
- Property tests (fast-check): determinism (same seed+log ⇒ identical state hash); fixed-point
  uniqueness for random block graphs; no resolution step ever references a dead seat's role
  textually; every game with random valid inputs terminates ≤ 50 day/night cycles.

### 12.2 Simulator & bots (`packages/bots`)

- `sim` CLI: runs N full games headlessly with policy bots (random-legal-action with simple
  heuristics: mafia kills a random town-leaning seat, town votes randomly, etc.), real engine,
  real server (in-process), real protocol over loopback sockets.
- Bots are protocol clients, not engine shortcuts — they exercise the gateway exactly like
  humans. One human + 14 bots must be a supported local dev mode (`pnpm dev:solo`).

### 12.3 Leak detector (mandatory, CI-gating)

- The simulator captures every frame sent to every client. After each game, an auditor walks the
  capture with full knowledge of the true state and asserts the §5 entitlement table: e.g. no
  frame to a non-mafia, living, `deadSeeAll`-irrelevant client ever contains another seat's role
  string, faction, night action, or mafia chat content, before legal reveal. Run ≥ 200 randomized
  games in CI. Any violation fails the build.

### 12.4 Fuzz & abuse tests

- Malformed/oversized/out-of-phase messages never crash the server (property: process survives
  100k random frames; all rejected frames produce `error` replies).
- Rate-limit tests; duplicate-connection takeover test; reconnect-resume snapshot equivalence
  test (resumed client's view state-hash equals a never-disconnected client's view).

### 12.5 E2E

- Playwright: 3-browser smoke (create private lobby, 1 human + bots backfilled via dev hook,
  play a full game, assert game_over screen).

---

## 13. Client (React) specification

### 13.1 Screens

1. **Home:** play as guest / login / register; join-by-code; public lobby browser.
2. **Lobby:** roster, setup summary (role list preview), config, chat, invite link, host
   controls, ready indicator, start button.
3. **Game** (one screen, the heart of the product):
   - Left: chat pane with channel tabs (Day / Mafia / Jail / Dead / Whispers as applicable);
     input with whisper targeting (`/w 7 text` and click-to-whisper).
   - Right: player list — seat number, name, alive/dead (dead show revealed role), vote button +
     current tally during DAY_VOTING, connection/AFK badges.
   - Top: phase banner + countdown + day number; dawn death announcements as paced modal feed.
   - Own panel: role card (name, faction, ability text, uses remaining), night-action target
     picker, last-will editor (autosaves), death-note editor for killers.
   - Trial overlay: accused, defense timer, guilty/innocent/abstain buttons, verdict reveal.
   - Game-over: winners, full role reveal table, personal result, "play again".
4. **Settings:** profanity filter toggle, mute list, colorblind-safe palette toggle (faction
   color is never the only signal — icons/labels always accompany color), text scale.

### 13.2 Client rules

- The client renders only what the server sent it; it holds no secret it didn't receive (a
  compromised client must learn nothing — this is guaranteed by §5, but the client must also
  never *infer-and-display* unverified claims as facts).
- Day/night ambiance: CSS scene tinting + light audio cues; no heavy art dependencies in MVP.
  All visual assets placeholder-original (simple shapes/icons) until the art pass.
- Strings: all user-facing text through a single `strings.ts` module from day one (cheap now,
  enables localization later).

---

## 14. Phase B — Electron + Steam (build later; design for it now)

- `apps/desktop`: Electron wrapper loading the same client bundle; `steamworks.js` for:
  Steam auth session tickets (server verifies via Steam Web API over HTTPS — no native code
  server-side), rich presence, friend invites (`+connect_lobby`-style launch args mapped to
  invite codes), achievements.
- Wrap all Steamworks access behind `packages/shared/src/platform.ts` interface with a no-op web
  implementation, so the client code never imports steamworks directly.
- Known constraints to honor when the time comes: pin the Electron version (overlay regressions —
  Electron 35 broke overlay; verify on the pinned version); overlay needs the in-process-GPU
  flag path; macOS SKU is deferred until after Steam-Windows traction.
- Steam accounts link to existing accounts as an auth identity (one identity table row), never a
  parallel account system.
- Week-one spike when Phase B starts: a throwaway Electron app exercising every Steamworks call
  above, on Windows + Steam Deck (Proton), before any architecture hardens around them.

---

## 15. Telemetry (privacy-light, population-health focused)

Server-side counters only (no third-party analytics in MVP): lobby wait time, lobby fill rate,
match completion rate (completed/started), disconnect & resume rates, reports per match, DAU and
concurrent-seat curves by hour + timezone. One daily rollup table + a simple `/admin/stats` page.
These are the death-spiral early-warning instruments; build them before launch, not after.

---

## 16. Milestones & acceptance criteria

**M0 — Scaffold + engine core (target: ~2 weeks of agent work)**
Monorepo builds; `shared` protocol schemas complete; engine phase machine + §6.8 resolver for
roles 1–15; golden + property tests green; `sim` runs 1,000 headless games without
crash/non-termination. *Accept: CI green incl. determinism hash test.*

**M1 — Server vertical slice**
Gateway, lobby create/join, full game loop server-driven, bots over real sockets, leak detector
green over 200 games. *Accept: `pnpm dev:solo` lets one human play a full game with 8 bots.*

**M2 — Playable client**
All §13 screens; full private-lobby game between humans in 3 browsers; reconnect mid-game works
(snapshot equivalence test green). *Accept: Playwright E2E green.*

**M3 — 15 roles + 3 setups + polish of rules edge cases**
Whole §6.5 table incl. flex roles; auto-scaling setup 7–15; trials/skip/stalemate guard; dawn
pacing; last wills/death notes; spectators. *Accept: all §12.1 golden cases green.*

**M4 — Accounts, persistence, moderation, deploy**
Argon2id auth + guests; §10 schema live; reports/mutes/sanctions + admin page; rate limits; fuzz
suite green; deployed on VPS behind Caddy + Cloudflare with graceful-drain deploys; telemetry
rollups. *Accept: a stranger can register, create a private lobby, play, report, and an admin
can sanction — on the production URL.*

**M5 — Launch hardening**
Onboarding (role cards, first-game tooltips, glossary), colorblind/text-scale settings, public
lobby browser polish, "play again" retention loop, OG/link previews for invite links.
*Accept: a 9-person playtest night with zero crashes; lobby-fill telemetry live.*

Phase B (Steam) is intentionally not scheduled here.

---

## 17. Out of scope for MVP (do not build, do not block)

Ranked/Glicko, host setup editor + per-role option toggles, Cult/conversion mechanics, Triad
(second evil faction), Witch/Bus Driver/Veteran/Mass Murderer/Spy/Coroner/Disguiser/
Blackmailer/Bodyguard and other post-MVP roles, voice chat, mobile, localization, replays UI
(the data model already supports it), Workshop/setup sharing, cosmetics/monetization, bot
backfill for public lobbies, Steam anything (Phase B).

---

## 18. Glossary (for implementers new to the genre)

- **Lynch:** the day-time majority execution of a player after trial.
- **Claim:** publicly asserting your role ("I'm the Doctor").
- **Roleblock (RB):** cancelling a player's night action.
- **Night-immune:** survives standard night attacks.
- **Visit:** performing an action on another player at night (observable by the Lookout).
- **Parity:** the moment the informed minority (Mafia) equals the rest — they control votes,
  so they win.
- **WIFOM** ("wine in front of me"): bluff/double-bluff reasoning loops players engage in.
- **N1/D2 etc.:** Night 1, Day 2 — standard shorthand for game timeline.
