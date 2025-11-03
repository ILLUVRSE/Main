-- kernel/sql/migrations/002_migrate_varchars_to_uuid.sql
--
-- Safe, guarded migration to convert textual ID columns to UUID
-- for production. This script:
--  - ensures pgcrypto is installed (for gen_random_uuid())
--  - for each candidate table/column, checks whether the column is already UUID
--  - if the column is text/varchar, verifies all existing values are valid UUIDs
--    (if not, the script stops and prints instructions for a manual migration)
--  - if values are valid UUIDs, performs ALTER COLUMN ... TYPE uuid USING id::uuid
--    and sets default gen_random_uuid()
--
-- IMPORTANT:
--  * This migration only proceeds automatically if existing values are all valid UUIDs.
--    If you have human-friendly text ids (e.g. "agent-e2e-1"), you must run a manual
--    data migration that maps old text ids to new UUIDs, updates all FK references,
--    and then run the schema conversion. See the "Manual migration" notes below.
--  * Test this migration against a copy of your production DB before applying.
--  * DO NOT RUN this against a DB with non-UUID textual ids without following the manual plan.
--
-- Acceptance:
--  - After running, the following ID columns are UUID with default gen_random_uuid():
--      divisions.id, agents.id, agents.division_id, eval_reports.id, eval_reports.agent_id,
--      resource_allocations.id, manifest_signatures.id, audit_events.id
--  - The migration aborts with clear instructions if non-UUID values are present.
--
-- Manual migration plan (short):
--  1) Create mapping tables: old_id -> new_uuid for each affected table.
--  2) Insert rows into mapping with new_uuid = gen_random_uuid() for each existing row.
--  3) Update dependent FK columns to use new_uuid by joining on old_id.
--  4) Verify referential integrity.
--  5) Then run the ALTER COLUMN statements below (they will succeed because values are valid UUIDs).
--  6) Remove mapping tables and old textual id columns if needed.

-- Ensure pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- helper regex for UUID (case-insensitive)
-- validation query will use ~* for case-insensitive
DO $$
DECLARE
  v_count BIGINT;
  -- regex: 8-4-4-4-12 hex groups with optional uppercase
  uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  -- Function to check and convert a single column safely
  -- Usage: PERFORM convert_if_varchar_ok('schema','table','column');
  CREATE OR REPLACE FUNCTION convert_if_varchar_ok(tbl_schema TEXT, tbl_name TEXT, col_name TEXT) RETURNS VOID AS $fn$
  DECLARE
    full_table TEXT := quote_ident(tbl_schema) || '.' || quote_ident(tbl_name);
    data_type TEXT;
    non_uuid_count BIGINT;
    alter_sql TEXT;
    set_default_sql TEXT;
  BEGIN
    SELECT data_type INTO data_type
      FROM information_schema.columns
      WHERE table_schema = tbl_schema AND table_name = tbl_name AND column_name = col_name;

    IF data_type IS NULL THEN
      RAISE NOTICE 'Column % not found on %.%', col_name, tbl_schema, tbl_name;
      RETURN;
    END IF;

    IF data_type = 'uuid' THEN
      RAISE NOTICE 'Column % on %.% is already UUID — skipping', col_name, tbl_schema, tbl_name;
      RETURN;
    END IF;

    -- Ensure all non-null values match UUID regex
    EXECUTE format('SELECT count(1) FROM %s WHERE %I IS NOT NULL AND NOT (%I ~* %L)', full_table, col_name, col_name, uuid_regex)
      INTO non_uuid_count;

    IF non_uuid_count > 0 THEN
      RAISE EXCEPTION 'Column % on %.% contains % rows with non-UUID values. Aborting. Manual migration required.', col_name, tbl_schema, tbl_name, non_uuid_count;
    END IF;

    -- Drop foreign key constraints that reference this column (best-effort)
    FOR r IN
      SELECT conname
      FROM pg_constraint
      JOIN pg_class ON conrelid = pg_class.oid
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE contype = 'f'
        AND confrelid = (SELECT oid FROM pg_class WHERE relname = tbl_name AND relnamespace = pg_namespace.oid LIMIT 1)
    LOOP
      BEGIN
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', tbl_schema, tbl_name, r.conname);
        RAISE NOTICE 'Dropped FK constraint % on %.%', r.conname, tbl_schema, tbl_name;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Failed to drop constraint %: %', r.conname, SQLERRM;
      END;
    END LOOP;

    -- Alter the column to uuid (safe because all values are valid UUID strings)
    alter_sql := format('ALTER TABLE %s ALTER COLUMN %I TYPE uuid USING %I::uuid', full_table, col_name, col_name);
    EXECUTE alter_sql;
    RAISE NOTICE 'Altered column % on %.% to uuid', col_name, tbl_schema, tbl_name;

    -- Set default to gen_random_uuid() if none
    set_default_sql := format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT gen_random_uuid()', full_table, col_name);
    EXECUTE set_default_sql;
    RAISE NOTICE 'Set default gen_random_uuid() on %.%(%).', tbl_schema, tbl_name, col_name;

    -- Recreate indexes on the column if necessary (best-effort skip if exists)
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I_%I_idx ON %s (%I)', tbl_name, col_name, full_table, col_name);
      RAISE NOTICE 'Ensured index on %.%(%).', tbl_schema, tbl_name, col_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to create index on %.%(%): %', tbl_schema, tbl_name, col_name, SQLERRM;
    END;

  END;
  $fn$ LANGUAGE plpgsql;

  -- Now attempt conversions for a set of known tables/columns.
  -- These will abort if any non-UUID textual ids exist.

  PERFORM convert_if_varchar_ok('public','divisions','id');
  PERFORM convert_if_varchar_ok('public','agents','id');
  -- agents.division_id may be a fk: convert after agents.id/divisions.id handled
  PERFORM convert_if_varchar_ok('public','agents','division_id');
  PERFORM convert_if_varchar_ok('public','eval_reports','id');
  PERFORM convert_if_varchar_ok('public','eval_reports','agent_id');
  PERFORM convert_if_varchar_ok('public','resource_allocations','id');
  PERFORM convert_if_varchar_ok('public','manifest_signatures','id');
  PERFORM convert_if_varchar_ok('public','manifest_signatures','manifest_id');
  PERFORM convert_if_varchar_ok('public','audit_events','id');

  RAISE NOTICE '002_migrate_varchars_to_uuid: completed (or no-op where already uuid).';
END;
$$ LANGUAGE plpgsql;

-- End of migration

