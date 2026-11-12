#!/bin/sh
# Creates Temporal's two databases on the shared Postgres server and applies schema migrations.
# Safe to re-run: existing databases and schemas are kept, versioned updates apply once.
set -eu
: "${POSTGRES_SEEDS:?POSTGRES_SEEDS is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
PORT="${DB_PORT:-5432}"
SCHEMA_DIR=/etc/temporal/schema/postgresql/v12

nc -z -w 10 "$POSTGRES_SEEDS" "$PORT"

for db in temporal temporal_visibility; do
  dir=temporal
  [ "$db" = temporal_visibility ] && dir=visibility
  sql() { temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$PORT" --db "$db" "$@"; }
  sql create || echo "database $db exists"
  sql setup-schema -v 0.0 || echo "schema for $db exists"
  sql update-schema -d "$SCHEMA_DIR/$dir/versioned"
done
echo 'Temporal schema ready'
