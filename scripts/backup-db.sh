#!/usr/bin/env bash
#
# Postgres backup for Project NOCTURNE (server-hardening Task G).
#
# Dumps the Nocturne database from the `nocturne-pg` docker container to a
# timestamped, gzipped SQL file, then prunes to the most recent N backups.
#
# Secrets are NEVER hardcoded — credentials are read from the environment:
#   DATABASE_URL    a full postgres URL (preferred; everything is derived from it)
#   -- or individual PG vars --
#   PGUSER          database user      (default: nocturne)
#   PGDATABASE      database name      (default: nocturne)
#   PGPASSWORD      password           (optional; pg_dump reads it from env)
#
# Knobs (all optional):
#   BACKUP_DIR      where dumps land   (default: ~/nocturne-backups)
#   BACKUP_KEEP     how many to keep   (default: 14)
#   PG_CONTAINER    docker container   (default: nocturne-pg)
#
# Usage:
#   ./scripts/backup-db.sh
#   BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 ./scripts/backup-db.sh
#
# The dump runs INSIDE the container (docker exec), so the host needs no psql
# client — only docker and a running `nocturne-pg`. See scripts/README.md for the
# restore procedure.

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-nocturne-pg}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/nocturne-backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

# --- Resolve credentials -----------------------------------------------------
# Prefer DATABASE_URL; otherwise fall back to discrete PG* vars with defaults.
DB_USER="${PGUSER:-nocturne}"
DB_NAME="${PGDATABASE:-nocturne}"
DB_PASSWORD="${PGPASSWORD:-}"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Parse postgres://user:pass@host:port/dbname using bash regex (no extra deps).
  proto_removed="${DATABASE_URL#*://}"
  creds="${proto_removed%@*}"          # user:pass  (or just user)
  hostpart="${proto_removed#*@}"       # host:port/dbname?query
  url_user="${creds%%:*}"
  if [[ "$creds" == *:* ]]; then
    url_pass="${creds#*:}"
  else
    url_pass=""
  fi
  url_dbname="${hostpart#*/}"          # dbname?query
  url_dbname="${url_dbname%%\?*}"      # strip ?sslmode=... etc

  [[ -n "$url_user" ]] && DB_USER="$url_user"
  [[ -n "$url_pass" ]] && DB_PASSWORD="$url_pass"
  [[ -n "$url_dbname" ]] && DB_NAME="$url_dbname"
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTFILE="$BACKUP_DIR/nocturne-${TIMESTAMP}.sql.gz"

echo "[backup-db] dumping '${DB_NAME}' from container '${PG_CONTAINER}' as '${DB_USER}'"
echo "[backup-db] → ${OUTFILE}"

# pg_dump runs inside the container; PGPASSWORD is passed via the docker env so it
# never appears in the host process list. Pipe straight into gzip on the host.
if ! docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
      pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip -9 > "$OUTFILE"; then
  echo "[backup-db] ERROR: pg_dump failed; removing partial file" >&2
  rm -f "$OUTFILE"
  exit 1
fi

SIZE="$(du -h "$OUTFILE" | cut -f1)"
echo "[backup-db] wrote ${OUTFILE} (${SIZE})"

# --- Prune to the most recent BACKUP_KEEP ------------------------------------
# List newest-first, skip the first BACKUP_KEEP, delete the rest.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/nocturne-*.sql.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))")
if [[ ${#OLD[@]} -gt 0 ]]; then
  echo "[backup-db] pruning ${#OLD[@]} old backup(s), keeping newest ${BACKUP_KEEP}"
  for f in "${OLD[@]}"; do
    rm -f -- "$f"
    echo "[backup-db]   removed $(basename "$f")"
  done
fi

echo "[backup-db] done."
