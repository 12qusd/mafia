# Operational scripts

## `backup-db.sh` — Postgres backup

Dumps the Nocturne database from the `nocturne-pg` docker container to a
timestamped, gzipped SQL file and prunes to the most recent N backups.

### What it does

- Runs `pg_dump` **inside** the `nocturne-pg` container (so the host needs no
  `psql`/`pg_dump` client — only `docker`).
- Writes `nocturne-YYYYmmdd-HHMMSS.sql.gz` into `BACKUP_DIR`.
- Keeps the newest `BACKUP_KEEP` files and deletes older ones.

### Configuration (environment)

Credentials are **never hardcoded** — they come from the environment:

| Var            | Default                | Notes                                              |
| -------------- | ---------------------- | -------------------------------------------------- |
| `DATABASE_URL` | _(unset)_              | Preferred. `postgres://user:pass@host:port/dbname` — user/pass/dbname are parsed out. |
| `PGUSER`       | `nocturne`             | Used if `DATABASE_URL` is unset.                   |
| `PGDATABASE`   | `nocturne`             | Used if `DATABASE_URL` is unset.                   |
| `PGPASSWORD`   | _(empty)_              | Passed to `pg_dump` via the container env.         |
| `BACKUP_DIR`   | `~/nocturne-backups`   | Where dumps are written (created if missing).      |
| `BACKUP_KEEP`  | `14`                   | How many most-recent dumps to retain.              |
| `PG_CONTAINER` | `nocturne-pg`          | The docker container running Postgres.             |

The production `DATABASE_URL` lives in `.env.production` (gitignored) and is also
baked into `ecosystem.config.cjs`.

### Run it

```bash
# Using the discrete defaults (user=nocturne, db=nocturne):
PGPASSWORD=… ./scripts/backup-db.sh

# Or derive everything from DATABASE_URL:
DATABASE_URL='postgres://nocturne:…@localhost:5433/nocturne' ./scripts/backup-db.sh

# Custom destination + retention:
BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 ./scripts/backup-db.sh
```

> **Operator note:** scheduling is intentionally NOT wired up. To run nightly,
> add your own cron entry, e.g.:
>
> ```cron
> # 03:15 every day — adjust DATABASE_URL / BACKUP_DIR as needed
> 15 3 * * * DATABASE_URL='postgres://nocturne:PASS@localhost:5433/nocturne' /home/fox/Projects/mafia/scripts/backup-db.sh >> /home/fox/nocturne-backups/backup.log 2>&1
> ```

### Restore

Decompress and pipe the dump into `psql` inside the container. **This applies the
dump to the existing database** — restore into a fresh/empty DB (or drop &
recreate the schema first) to avoid conflicts:

```bash
gunzip -c ~/nocturne-backups/nocturne-YYYYmmdd-HHMMSS.sql.gz \
  | docker exec -i nocturne-pg psql -U nocturne -d nocturne
```

To restore into a clean database first:

```bash
# Drop & recreate (DESTRUCTIVE — make sure you have a current backup):
docker exec -i nocturne-pg psql -U nocturne -d postgres \
  -c "DROP DATABASE IF EXISTS nocturne;" -c "CREATE DATABASE nocturne;"

gunzip -c ~/nocturne-backups/nocturne-YYYYmmdd-HHMMSS.sql.gz \
  | docker exec -i nocturne-pg psql -U nocturne -d nocturne
```

If you restore into a brand-new database, also run the idempotent schema
migration afterward to seed default chat rooms / forum boards (see the deploy
notes): `node packages/server/dist/db/migrate.js` with `DATABASE_URL` set.
