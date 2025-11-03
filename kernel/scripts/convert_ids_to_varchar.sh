#!/usr/bin/env bash
#
# kernel/scripts/convert_ids_to_varchar.sh
#
# Safe wrapper script to convert UUID PK/FK columns to VARCHAR (text) in the local
# illuvrse-postgres Docker container.  This runs a guarded SQL migration inside the
# container (single transaction).  **Do a DB backup before running**.
#
# Usage:
#   chmod +x kernel/scripts/convert_ids_to_varchar.sh
#   ./kernel/scripts/convert_ids_to_varchar.sh
#
# Notes / Warnings:
# - This modifies schema in-place. Run only against your local dev DB or a tested copy
#   of production. Make a backup (pg_dump) first.
# - The script expects a Docker container named `illuvrse-postgres` to be running and
#   that `psql` is available inside the container.
# - The SQL uses ALTER TABLE ... USING id::text to preserve existing values.
# - If you want to inspect the SQL before running, open this file and read the heredoc.
#
set -euo pipefail

CONTAINER="${CONTAINER:-illuvrse-postgres}"

echo "This script will alter schema in the '${CONTAINER}' container."
echo
echo "!!! WARNING: This is destructive if your data is not ready. BACKUP first. !!!"
echo
read -p "Have you backed up the database and confirmed this is a safe environment? Type 'yes' to proceed: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborting. Type 'yes' to run the migration after backing up."
  exit 2
fi

# Check container exists and is running
if ! sudo docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}\$"; then
  echo "Error: Docker container '${CONTAINER}' not running. Start it first."
  exit 3
fi

echo "Running conversion SQL inside container: ${CONTAINER}"
sudo docker exec -i "${CONTAINER}" psql -U postgres -d illuvrse -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

-- Ensure gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop dependent foreign keys (we discovered these earlier)
ALTER TABLE IF EXISTS divisions DROP CONSTRAINT IF EXISTS divisions_manifest_signature_id_fkey;
ALTER TABLE IF EXISTS agents DROP CONSTRAINT IF EXISTS agents_division_id_fkey;
ALTER TABLE IF EXISTS eval_reports DROP CONSTRAINT IF EXISTS eval_reports_agent_id_fkey;

-- Drop primary keys so we can alter column types
ALTER TABLE IF EXISTS audit_events DROP CONSTRAINT IF EXISTS audit_events_pkey;
ALTER TABLE IF EXISTS manifest_signatures DROP CONSTRAINT IF EXISTS manifest_signatures_pkey;
ALTER TABLE IF EXISTS divisions DROP CONSTRAINT IF EXISTS divisions_pkey;
ALTER TABLE IF EXISTS agents DROP CONSTRAINT IF EXISTS agents_pkey;
ALTER TABLE IF EXISTS eval_reports DROP CONSTRAINT IF EXISTS eval_reports_pkey;
ALTER TABLE IF EXISTS resource_allocations DROP CONSTRAINT IF EXISTS resource_allocations_pkey;

-- Convert ID and FK columns to text (preserve existing values)
ALTER TABLE IF EXISTS manifest_signatures ALTER COLUMN id TYPE VARCHAR USING id::text;
ALTER TABLE IF EXISTS manifest_signatures ALTER COLUMN manifest_id TYPE VARCHAR USING manifest_id::text;

ALTER TABLE IF EXISTS divisions ALTER COLUMN id TYPE VARCHAR USING id::text;

ALTER TABLE IF EXISTS agents ALTER COLUMN id TYPE VARCHAR USING id::text;
ALTER TABLE IF EXISTS agents ALTER COLUMN division_id TYPE VARCHAR USING division_id::text;

ALTER TABLE IF EXISTS eval_reports ALTER COLUMN id TYPE VARCHAR USING id::text;
ALTER TABLE IF EXISTS eval_reports ALTER COLUMN agent_id TYPE VARCHAR USING agent_id::text;

ALTER TABLE IF EXISTS resource_allocations ALTER COLUMN id TYPE VARCHAR USING id::text;
ALTER TABLE IF EXISTS resource_allocations ALTER COLUMN entity_id TYPE VARCHAR USING entity_id::text;

ALTER TABLE IF EXISTS audit_events ALTER COLUMN id TYPE VARCHAR USING id::text;

-- Ensure defaults produce text UUIDs
ALTER TABLE IF EXISTS audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS manifest_signatures ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS divisions ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS agents ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS eval_reports ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS resource_allocations ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Recreate primary keys
ALTER TABLE IF EXISTS audit_events ADD PRIMARY KEY (id);
ALTER TABLE IF EXISTS manifest_signatures ADD PRIMARY KEY (id);
ALTER TABLE IF EXISTS divisions ADD PRIMARY KEY (id);
ALTER TABLE IF EXISTS agents ADD PRIMARY KEY (id);
ALTER TABLE IF EXISTS eval_reports ADD PRIMARY KEY (id);
ALTER TABLE IF EXISTS resource_allocations ADD PRIMARY KEY (id);

-- Recreate foreign keys
ALTER TABLE IF EXISTS divisions
  ADD CONSTRAINT divisions_manifest_signature_id_fkey FOREIGN KEY (manifest_signature_id) REFERENCES manifest_signatures(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS agents
  ADD CONSTRAINT agents_division_id_fkey FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS eval_reports
  ADD CONSTRAINT eval_reports_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS resource_allocations
  ADD CONSTRAINT resource_allocations_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES divisions(id) ON DELETE CASCADE;

COMMIT;
SQL

RC=$?
if [ "$RC" -eq 0 ]; then
  echo "Schema conversion completed successfully."
else
  echo "Schema conversion failed with exit code $RC"
fi

echo "You can inspect recent Postgres logs with:"
echo "  sudo docker logs --tail 50 ${CONTAINER}"

# End of script

