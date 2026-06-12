# Project NOCTURNE (working codename)

A standalone online social-deduction game in the Mafia/Werewolf genre, mechanically descended
from the StarCraft II Arcade map **SC2Mafia** (the ancestor of Town of Salem). Web-first,
with a later Electron + Steam desktop release.

This repository currently contains the **planning artifacts**: a complete research dossier and
the implementation-ready build specification. Code comes next.

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

- [x] Research dossier (5-agent deep research + adversarial critique, June 2026)
- [x] Build specification v1.0
- [ ] Spec review patches (adversarial spec review in progress)
- [ ] M0: monorepo scaffold + pure rules engine
- [ ] M1–M5 per BUILD_SPEC.md §16
