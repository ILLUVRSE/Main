-- kernel/sql/migrations/002_audit_pipeline.sql
-- Add durable streaming & archival columns to audit_events to support a DB-first
-- durable audit pipeline (Kafka + S3). The migration is written to be idempotent.
--
-- Columns added:
--  - metadata (JSONB) to allow storing optional per-event metadata
--  - s3_object_key / s3_archived_at / s3_archive_attempts / s3_last_error
--  - kafka_topic / kafka_partition / kafka_offset / kafka_produced_at /
--    kafka_produce_attempts / kafka_last_error
--  - stream_status / stream_attempts / last_stream_attempt_at / last_stream_error
--
-- Partial indexes added to speed up selecting pending work for the background worker.

BEGIN;

-- Ensure metadata column exists (some older DBs may not have it)
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS s3_object_key TEXT,
  ADD COLUMN IF NOT EXISTS s3_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS s3_archive_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS s3_last_error TEXT,
  ADD COLUMN IF NOT EXISTS kafka_topic VARCHAR,
  ADD COLUMN IF NOT EXISTS kafka_partition INTEGER,
  ADD COLUMN IF NOT EXISTS kafka_offset BIGINT,
  ADD COLUMN IF NOT EXISTS kafka_produced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kafka_produce_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kafka_last_error TEXT,
  ADD COLUMN IF NOT EXISTS stream_status VARCHAR NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stream_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_stream_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_stream_error TEXT;

-- Partial indexes to accelerate worker selection of pending rows.
CREATE INDEX IF NOT EXISTS idx_audit_events_kafka_pending ON audit_events (ts)
  WHERE kafka_produced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_s3_pending ON audit_events (ts)
  WHERE s3_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_stream_status_ts ON audit_events (stream_status, ts);

COMMIT;

-- Acceptance checklist (manual/quick tests):
-- 1) The migration runs idempotently (run twice — second run should not error).
-- 2) The following columns now exist on audit_events:
--    metadata, s3_object_key, s3_archived_at, s3_archive_attempts, s3_last_error,
--    kafka_topic, kafka_partition, kafka_offset, kafka_produced_at,
--    kafka_produce_attempts, kafka_last_error,
--    stream_status, stream_attempts, last_stream_attempt_at, last_stream_error
-- 3) The three indexes exist: idx_audit_events_kafka_pending,
--    idx_audit_events_s3_pending, idx_audit_events_stream_status_ts.

