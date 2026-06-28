# @nocturne/e2e — browser smoke

A **standalone** Playwright-driven browser smoke of the guest core gameplay loop.
It is **not** part of `pnpm -r test` / the unit gate — a real browser driving a
full bot-backed game is slow and needs a chromium binary, so it must never slow
or flake the unit gate. Run it manually or as an optional CI step.

## Run

```sh
pnpm e2e          # from the repo root
```

That invokes `packages/e2e/src/smoke.mjs`, which:

1. builds the client + server (so the server serves the freshly-built SPA),
2. boots the **real** server in **NO_DB** mode on an ephemeral loopback port,
3. launches the already-installed chromium via **playwright-core**,
4. drives the guest core loop:
   load home → click **Quick Play** → wait for the bot-backfilled game to start →
   assert the game is **live** (the own-seat role card and the seat roster render),
5. asserts **zero console errors** across the whole journey.

Clear pass/fail output + exit code: `PASS` / exit 0 on success, `FAIL …` / exit 1
on any failure.

## Chromium binary

The runner needs a chromium executable. It looks, in order, at:

1. the path in `/tmp/shot/chrome_path.txt` (the chromium installed in this
   environment), then
2. the `PLAYWRIGHT_CHROMIUM` env var.

If neither points at an existing binary, the runner prints
`SKIP: no chromium …` and **exits 0** — so a CI without a browser never
hard-fails.

Headless launch args (known-good here):

```
--no-sandbox --use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist
```

## Scope

Deliberately limited to the **guest gameplay loop**, the highest-value browser
coverage and the only thing that runs under NO_DB. Account flows
(register / forum / DMs) need a database and are covered elsewhere by the
server's route/store unit tests, not here.
