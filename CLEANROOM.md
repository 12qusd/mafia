# CLEANROOM.md

Contemporaneous record of the clean-room process for Project NOCTURNE, per
`BUILD_SPEC.md` §2.1.5. The game's **mechanics** are intentionally derived from
the SC2Mafia / Town of Salem genre lineage (mechanics are not protectable);
everything **expressive** — role descriptions, result strings, announcements,
flavor, names, visual identity — is written fresh for this project.

## Sources consulted for expressive content

Across the whole build — the monorepo scaffold + `packages/shared`, and the
engine, server, client, and bots packages — the **only** source consulted while
authoring code, data, and all player-facing text was:

- **`BUILD_SPEC.md`** (this repository) — Project NOCTURNE Build Specification
  v1.0. Self-contained per its own preamble; it states mechanical facts only.

No other source was used to write any expressive content. Every player-facing
string the packages add (engine result/announcement copy, server error text,
client UI/screen copy in `strings-extra.ts`, and the bots' canned noir chat
lines) was written fresh in the 1920s-noir register, copied from no source game.
In particular:

- No text was copied or paraphrased from the Town of Salem wiki/game, the
  SC2Mafia map or wiki, or any other game, for role descriptions, investigation
  result strings, announcements, error messages, or any other player-facing
  copy.
- No StarCraft / Blizzard assets, names, icons, fonts, or marketing references
  were used (§2.1.1).
- Only generic, dictionary-word / real-mafia-terminology role names are used
  (Citizen, Sheriff, Investigator, Lookout, Doctor, Escort, Jailor, Vigilante,
  Mayor, Godfather, Mafioso, Consort, Framer, Serial Killer, Jester,
  Executioner, Survivor). No coined/distinctive names from the source games are
  present (§2.1.3).

## Note on the `research/` directory

This repository also contains a pre-existing `research/` dossier that predates
this build work. It was **not** consulted while writing any of the expressive
content (role copy, strings, flavor) in `packages/shared`; all such text was
authored solely from `BUILD_SPEC.md`'s mechanical descriptions, in an original
1920s noir / Prohibition voice (theme recorded in `DECISIONS.md`).

## Theme

Chosen visual/voice direction: **1920s noir / Prohibition** — selected from the
spec's suggested options and recorded in `DECISIONS.md` (§2.1.4). The identity
is intended to be visually distant from both StarCraft and Town of Salem's
colonial-Salem trade dress.

## Public rules references

None beyond `BUILD_SPEC.md` were used in any phase of this build. Any future
external rules reference must be appended here by URL, with the date consulted,
before it informs any code or copy.
