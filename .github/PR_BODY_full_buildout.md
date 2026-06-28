## Project NOCTURNE — full game + production-readiness buildout

This branch takes NOCTURNE from spec to a launch-ready 1920s-noir Mafia / social-deduction game: the complete deterministic game engine, a full web client, and an 8-wave production-readiness program (security, retention, accessibility, ranked depth, social, and niceties). **42 commits · 265 files · ~46.5k insertions.**

**Quality bar (held across every commit):** `pnpm -r build && pnpm -r test && npx eslint .` clean · **955 tests** · the §5 information-leak auditor **0/200** · engine determinism property tests green.

---

### The game
- **50 SC2Mafia-style roles** across 5 factions (Town / Mafia / Triad / Vampire / Cult, + neutrals). Deterministic, auditable night engine — seeded PRNG, no `Date.now`/`Math.random`; same setup+seed+log ⇒ byte-identical state hash. Byte-identical replays with HMAC-SHA256 fingerprints.
- Points economy + **79 achievements**; **Glicko-2 ranked** (seasons, rank ladder, matchmaking); point-gated **role unlocks** (blacklist@2500 / prefer@6000); **Quick Play** with in-process bot-backfill (a solo player gets a full 7-player game in ~12s).
- Admin god-powers + moderation (reports / sanctions / mutes / audit log); custom setup builder + setup-of-the-day; three.js cinematic stage; art-deco noir UI; mobile-optimized; colorblind-safe; `prefers-reduced-motion` aware.

### Production-readiness waves
- **W1 — launch-blockers:** test-mode admin-gated in prod · HTTP rate-limiting (anti-spoof keyed on `cf-connecting-ip`) · `Secure` cookie + sliding session refresh + constant-time auth (no enumeration oracle) · crash handlers + DB health-check · **Vigilante-N1 engine bug fixed**.
- **W2 — retention:** pluggable email + password reset + verification + welcome · a real **"Play again" rematch** (keeps the crowd) · `/how-to-play` + first-game onboarding · home social proof · replay sharing with per-page OG link-preview cards.
- **W3 — accessibility & polish:** keyboard-reachable roster/chat (whisper was unreachable) · aria-live announcements · modal focus traps · WCAG-AA contrast · form labels/errors/counters · 44px touch targets · code-split (initial JS 558→456 kB).
- **W4 — ranked depth + social completeness:** season rollover/soft-reset/archive · placements · MMR inactivity decay · leaver penalty · leaderboard pagination + self-rank — and DM unread badges · user search · blocking · message deletion · per-room activity.
- **W5 — niceties & QoL:** notifications center (bell + feed) · deterministic avatars · @mentions · quote/reply · forum search · report-from-profile · referrals (`?ref=` + bonus) · pluggable Sentry error sink · perf (single-query forum index, batched ranked inserts).

### Invariants (never violated by any social/ranked/retention/notification work)
The engine, `transport.ts`/ScopedTransport, the game WS protocol, and the §5 leak path were never touched by the HTTP/own-tables feature work. Only finished matches are ever exposed on public/replay surfaces. The one engine change in the whole branch is the Vigilante Night-1 hold-fire fix.

### Pre-merge adversarial review
A final 5-lens review (authz/IDOR · leak-safety · economy/abuse · cross-wave state · regression/ops; 22 agents) returned **merge-with-fixes**. It caught one genuine merge-blocker that every per-wave gate missed — a `setConfig` test-mode bypass letting a non-admin host enable the live god-view after lobby creation (a §5 leak the in-engine bots auditor structurally can't see). **Fixed** (+ regression tests, verified live), along with ban-checks on start/rematch, a `/api/blocks` rate-limit, and test-mode exclusion from public surfaces. Everything else re-verified as already-correct.

### Operator follow-ups (post-merge, none blocking)
1. `pm2 startup systemd` + `pm2 save` (sudo) — reboot survival
2. `SMTP_*` env — real email delivery (reset/verify links log until then)
3. `SENTRY_DSN` (optional) — external error reporting
4. cron `scripts/backup-db.sh` — DB backups
5. Register an account + set its admin flag (`flags | 1`) — for prod test-mode QA
6. Seasons roll over on demand: `POST /api/admin/seasons/rollover`

### Knowingly deferred (lowest value / highest effort)
Horizontal scaling (in-memory game state is the single-process ceiling — fine at current scale) · a browser E2E + load/soak suite · automating the chat-partition retention job · typing indicators · chat-room lock/pin moderation UI. All catalogued in `DECISIONS.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
