# Deployment — Project NOCTURNE

This document describes how to run NOCTURNE as a **single instance** (the default)
and how to scale it **horizontally** to N instances behind a sticky-session
reverse proxy. It is written for a homelab operator and is deliberately honest
about what is and is not cluster-coherent.

---

## 1. Architecture

NOCTURNE is a stateful, deterministic Mafia game server (Fastify HTTP + `ws` on
the **same port**, Postgres for persistence, behind a Cloudflare tunnel, under
pm2).

There are exactly two kinds of state:

| Kind | Where it lives | Examples |
| --- | --- | --- |
| **Durable + coordination state** | **One shared Postgres** | accounts, sessions, social (profiles/friends/DMs/rooms), forums, ranked (ratings/seasons), points/achievements, moderation, custom setups, presence (`users.last_seen_at`), the server-instance registry |
| **In-flight game state** | **Per-instance process memory** | open lobbies, the invite-code index, the matchmaking queues (quick-play + ranked), the live game rooms + their engine state, the `mmrCache` |

### The shard unit is the game room

A **game room lives entirely on one process**. This is the correct shard
boundary, not a limitation:

- The engine is **pure + deterministic** and the WS transport enforces a §5
  information-leak model (`ScopedTransport` gives each connection only the
  entitlements its seat may see). Both of these guarantees hold *because* a room
  is owned by a single process with a single in-memory authority.
- Spreading one room across processes would require Redis-backed room state or
  WS proxying between nodes — adding latency and, more importantly, a
  determinism / leak-audit risk. That is **not** warranted at this scale.

So "horizontal scaling" here means: **run N stateless-front instances against the
one shared Postgres, and pin each player to the instance that owns their lobby /
room.** Postgres is the single source of truth for everything durable; the game
rooms are sharded by process.

---

## 2. What is cluster-coherent vs per-instance

**Cluster-coherent** (correct no matter which instance answers — all read/write
the shared Postgres):

- Accounts, login/sessions (a session cookie is valid on any instance).
- Social: profiles, friends, DMs, chat rooms, forums.
- Ranked: ratings, seasons, leaderboards.
- Points, achievements, leaderboards.
- Moderation: bans/mutes/reports/audit.
- Custom setups.
- **Presence / online count** — every instance writes `users.last_seen_at`;
  `GET /api/stats/online` returns the cluster-wide count from the DB.
- **Server-instance registry** — every instance heartbeats into
  `server_instances`; `GET /healthz?deep=1` reports the live-instance count.

**Per-instance** (resolves within the player's owning instance):

- The **public lobby browser** (`GET /api/lobbies`) lists only the lobbies open
  on the instance that serves the request.
- **Private-lobby invite joins** (`/join/<code>`) resolve against the in-memory
  invite index of the instance that owns the code.
- The **matchmaking queues** (quick-play + ranked) form games from the players
  currently connected to that instance.

This is acceptable because **Quick Play + bot-backfill make per-instance
matchmaking always succeed**: a player who hits "Quick Play" is matched from
their instance's queue and, if not enough humans are waiting, the lobby is
back-filled with bots — so a game always forms regardless of how the cluster is
sharded. Sticky sessions (below) keep a player and the people they invite on the
same instance, so a private group lands together.

> **Documented future enhancement.** Cross-instance *public-lobby discovery*
> (seeing and joining a public lobby that is open on a *different* instance) is
> not implemented. It would require either a **shared lobby registry** (publish
> open public lobbies to Postgres/Redis and route a joiner to the owning
> instance) or **room-affinity routing** at the proxy. Until then, public lobbies
> are discoverable only within an instance; invite links + Quick Play cover the
> common paths.

---

## 3. Sticky-session routing (required for N > 1)

Because a player's lobby/room lives on one instance, the reverse proxy **must
pin each client's HTTP *and* WebSocket traffic to one instance**. NOCTURNE serves
HTTP and the `/ws` WebSocket on the **same port**, so a single sticky rule covers
both. Pin on the **`nocturne_session` cookie** (the session cookie set by the
auth/guest flows) so a player's lobby, their live room, and reconnects all stay
on their owning instance.

### 3a. Caddy (cookie-based load balancing — preferred)

```caddyfile
# Front N NOCTURNE instances; pin each client by the nocturne_session cookie.
mafia.0cs.me {
    reverse_proxy 127.0.0.1:8081 127.0.0.1:8082 {
        lb_policy cookie nocturne_session
        # WebSocket upgrades are proxied transparently by Caddy; no extra config.
        health_uri /healthz
        health_interval 10s
    }
}
```

`lb_policy cookie nocturne_session` makes Caddy hash on the existing
`nocturne_session` cookie and route a given value to a stable upstream. (Caddy's
`cookie` policy also sets its own affinity cookie as a fallback for requests that
have no `nocturne_session` yet, e.g. the very first page load — that first
request lands somewhere stable and subsequent ones follow it.)

### 3b. nginx (sticky cookie / ip_hash alternative)

```nginx
# Sticky by cookie (nginx Plus has `sticky cookie`; OSS uses ip_hash or the
# 3rd-party nginx-sticky-module). ip_hash works without a module but pins by
# client IP rather than by session.
upstream nocturne {
    # Option A (nginx Plus): sticky on a route cookie.
    # sticky cookie nocturne_lb expires=1h httponly;

    # Option B (OSS, no module): pin by client IP.
    ip_hash;
    server 127.0.0.1:8081;
    server 127.0.0.1:8082;
}

server {
    listen 8080;
    server_name mafia.0cs.me;

    location / {
        proxy_pass http://nocturne;
        proxy_http_version 1.1;
        # WebSocket upgrade on the SAME location (HTTP + /ws share the port).
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;   # long-lived game sockets
    }
}
```

> Prefer cookie affinity (`nocturne_session`) over `ip_hash` when you can: several
> players behind one NAT share an IP, so `ip_hash` would pin them all to one
> instance. Cookie affinity pins per *session*, which is what we want.

### 3c. Behind the existing cloudflared tunnel

The Cloudflare tunnel already terminates at `localhost:8080`. With N instances,
point the tunnel at the **proxy** (Caddy/nginx) on `8080` instead of directly at
a Node process, and let the proxy fan out to `8081/8082`:

```
Internet → Cloudflare → cloudflared tunnel → localhost:8080 (Caddy/nginx, sticky)
                                                   ├── 127.0.0.1:8081  (instance 1)
                                                   └── 127.0.0.1:8082  (instance 2)
```

`cloudflared` itself does not need changes — its ingress still targets
`http://localhost:8080`; only what listens on 8080 changes (the proxy, not Node).
Cloudflare proxies WebSockets transparently, so `/ws` continues to work.

---

## 4. Running N instances (pm2)

Run each instance on its own port with a **distinct `SERVER_INSTANCE_ID`** and
the **same `DATABASE_URL`** (one shared Postgres). The proxy from §3 fronts them
on 8080.

```js
// ecosystem.cluster.cjs — 2 instances behind the §3 proxy on :8080
const shared = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://nocturne:nocturne@localhost:5433/nocturne',
  SESSION_SECRET: '<same long random secret on every instance>',
  ADMIN_TOKEN: '<same long random admin token on every instance>',
  CLIENT_DIST_DIR: '/home/fox/Projects/mafia/packages/client/dist',
};

module.exports = {
  apps: [
    {
      name: 'nocturne-1',
      script: 'packages/server/dist/start.js',
      cwd: '/home/fox/Projects/mafia',
      env: { ...shared, PORT: '8081', SERVER_INSTANCE_ID: 'inst-1', SERVER_HOST_LABEL: 'mrfox' },
      kill_timeout: 5000,
      autorestart: true,
    },
    {
      name: 'nocturne-2',
      script: 'packages/server/dist/start.js',
      cwd: '/home/fox/Projects/mafia',
      env: { ...shared, PORT: '8082', SERVER_INSTANCE_ID: 'inst-2', SERVER_HOST_LABEL: 'mrfox' },
      kill_timeout: 5000,
      autorestart: true,
    },
  ],
};
```

`SESSION_SECRET` **must be identical** on every instance (sessions are validated
against the shared Postgres, but the secret derives the session-token hash, so a
mismatch would make cookies issued by one instance fail on another). Likewise
keep `ADMIN_TOKEN` identical. If `SERVER_INSTANCE_ID` is left unset, each process
generates a random `inst-<uuid>` at boot — fine, but setting it explicitly makes
the registry / `/healthz` output readable.

> The single-instance `ecosystem.config.cjs` in the repo root is unchanged and
> still the simplest way to run NOCTURNE; this cluster file is additive.

---

## 5. Observing the cluster

- **`GET /api/stats/online`** → `{ online, instances }`.
  `online` is the cluster-wide count of accounts seen in the last ~2 minutes
  (from `users.last_seen_at`); `instances` is the live-instance count. Under a
  non-persistent (NO_DB) store it falls back to the local socket count and just
  returns `{ online }` (back-compatible — the field is always present).
- **`GET /healthz`** → cheap liveness (`ok`, `game`, `draining`, `persistent`,
  `uptimeSec`, `serverBuild`). No DB round-trip.
- **`GET /healthz?deep=1`** → adds a `db` pool-stats block, this process's
  **`instanceId`**, and the live **`instances`** count from the registry. All
  best-effort: a DB/registry blip yields `db.ok:false` / `instances:0`, never a
  500. Point the proxy health checks at `/healthz` (cheap).

The registry lives in `server_instances`: each instance upserts its row at boot,
bumps `last_heartbeat_at` every ~30s (`INSTANCE_HEARTBEAT_MS`), removes its row
on a graceful shutdown, and the maintenance sweep prunes any row whose heartbeat
is older than ~90s (`INSTANCE_STALE_MS`) — so a crashed instance disappears from
the live count within the stale window.

---

## 6. Operational notes

- **Migrations run ONCE against the shared DB before rolling instances.** The
  schema is idempotent + additive (every statement is `CREATE ... IF NOT EXISTS`
  / `ADD COLUMN IF NOT EXISTS`), so re-running is safe, but you only need it once
  per deploy:

  ```bash
  pnpm --filter @nocturne/server build
  DATABASE_URL=... node packages/server/dist/db/migrate.js
  # then (re)start the instances
  ```

  This deploy adds the `server_instances` table (and an index on
  `last_heartbeat_at`); nothing else changes.

- **The maintenance sweep + instance prune are safe to run on every instance.**
  Both the retention DELETEs and `pruneStaleInstances` are idempotent and
  best-effort: whichever instance sweeps first does the work, the rest find
  nothing to do. There is no leader election and none is needed.

- **Graceful drain is per-instance.** `SIGTERM`/`SIGINT` stops new lobbies on
  that instance, lets its running games finish (up to `DRAIN_MAX_MS`), removes
  its registry row, and exits. During a rolling restart, drain instances one at a
  time so the proxy keeps routing to the others.

- **Scale guidance.** A single instance is correct and is the default; reach for
  a second instance only when one process is genuinely the bottleneck (sustained
  high CPU from many concurrent live games, or you want zero-downtime rolling
  restarts). Because matchmaking and the public lobby browser are per-instance,
  adding instances *thins* each instance's matchmaking pool — Quick Play +
  bot-backfill keep games forming, but for a small player base one instance gives
  the densest lobbies. Add instances for headroom/CPU, not to chase a bigger
  shared lobby (that needs the cross-instance discovery enhancement in §2).

---

## 7. Config knobs added for horizontal scaling

| Env var | Default | Meaning |
| --- | --- | --- |
| `SERVER_INSTANCE_ID` | `inst-<uuid>` (generated once at boot) | Stable id for this process in the registry / `/healthz`. |
| `SERVER_HOST_LABEL` | `$HOSTNAME` or `local` | Human host label stored in the registry. |
| `INSTANCE_HEARTBEAT_MS` | `30000` | Registry heartbeat cadence. |
| `INSTANCE_STALE_MS` | `90000` | Liveness window; older rows are pruned + excluded from the live count. |

### SIGHUP — minimal hot-reload

Sending **`SIGHUP`** to an instance re-reads the *cheap, live-consumed* config
from the environment and applies it **in place, without a restart and without
disturbing any connection or in-flight game**:

- **Hot-applied** (read live on each request / sweep): the per-route rate limits
  (`RATE_LIMIT_*`) and the retention / instance-stale windows
  (`CHAT_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS`, `INSTANCE_STALE_MS`).
- **Restart-required** (logged as such, *not* hot-swapped): `PORT`, `HOST`,
  `DATABASE_URL`, `SESSION_SECRET`, `CLIENT_DIST_DIR`, and the timer intervals
  `MAINTENANCE_INTERVAL_MS` / `INSTANCE_HEARTBEAT_MS` (bound into running timers).

`SIGHUP` logs a structured `config reload (SIGHUP)` line with the effective
values and, if any changed setting needs a restart, a `restartRequiredFor`
warning. It is distinct from the `SIGTERM`/`SIGINT` graceful-drain path — it
neither drains nor exits. Update the env (e.g. in the pm2 ecosystem file) and:

```bash
kill -HUP <pid>     # or, per pm2 app:
pm2 sendSignal SIGHUP nocturne-1
```
```
