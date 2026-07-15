# CLAUDE.md — Mafia / Nocturne

Game project on mrfox. Deploy/test conventions: pm2, test mode — see the repo
docs and the operator's standing instructions.

## Homelab docs (mandatory for any infra-touching task)

The canonical docs for the homelab fleet (NAS storage, SSH mesh, tunnels,
machines, backups) live in the HomeLabDocs repo (`github.com:12qusd/HomeLabDocs`;
on this machine: `~/Projects/HomeLabDocs`). Before reading, refresh:
`git -C ~/Projects/HomeLabDocs pull --ff-only`; if that checkout is dirty
(another agent mid-flight), read committed truth via
`git -C ~/Projects/HomeLabDocs show origin/main:<path>` instead.
Start at its `CLAUDE.md` router and read the rows matching your task.
Non-negotiable basics: you already have passwordless NAS access (**never ask
for NAS credentials**); never password-spray SSH; no secrets in any repo; the
live machine outranks any doc. Allowed-action tiers: its `policies/global.yaml`.
