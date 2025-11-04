package audit

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"

	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// This integration test is intentionally gated on environment variables so it only
// runs when you have Postgres, Kafka and S3 available for testing.
//
// Required environment variables to run this test:
//
//	TEST_DATABASE_URL    -> postgres connection string (e.g. postgres://user:pass@host:5432/dbname?sslmode=disable)
//	TEST_KAFKA_BROKERS   -> comma-separated kafka brokers (host:port)
//	TEST_KAFKA_TOPIC     -> topic to produce to (must exist)
//	TEST_S3_BUCKET       -> S3 bucket to use (must exist and be writable by AWS creds)
//
// Optional:
//
//	TEST_S3_PREFIX       -> prefix to use for S3 keys (may be empty)
//
// Usage:
//
//	(set the environment variables) && go test ./kernel/internal/audit -run TestIntegration_DurablePipeline -v
func TestIntegration_DurablePipeline(t *testing.T) {
	dbURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	kafkaBrokers := strings.TrimSpace(os.Getenv("TEST_KAFKA_BROKERS"))
	kafkaTopic := strings.TrimSpace(os.Getenv("TEST_KAFKA_TOPIC"))
	s3Bucket := strings.TrimSpace(os.Getenv("TEST_S3_BUCKET"))
	s3Prefix := strings.TrimSpace(os.Getenv("TEST_S3_PREFIX"))

	if dbURL == "" || kafkaBrokers == "" || kafkaTopic == "" || s3Bucket == "" {
		t.Skip("integration test skipped; set TEST_DATABASE_URL, TEST_KAFKA_BROKERS, TEST_KAFKA_TOPIC, TEST_S3_BUCKET to run")
	}

	// Connect to Postgres
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	// Apply migrations (idempotent). Paths are relative to this package (kernel/internal/audit).
	migrations := []string{
		"../../sql/migrations/001_init.sql",
		"../../sql/migrations/002_audit_pipeline.sql",
	}
	for _, m := range migrations {
		b, err := os.ReadFile(m)
		if err != nil {
			t.Fatalf("read migration %s: %v", m, err)
		}
		if _, err := db.ExecContext(ctx, string(b)); err != nil {
			t.Fatalf("exec migration %s: %v", m, err)
		}
	}

	// Initialize store + signer
	pstore := NewPGStore(db)
	signClient := signer.NewLocalSigner("integration-test-signer")

	// Kafka producer
	brokers := strings.Split(kafkaBrokers, ",")
	for i := range brokers {
		brokers[i] = strings.TrimSpace(brokers[i])
	}
	kCfg := KafkaProducerConfig{
		Brokers: brokers,
		Topic:   kafkaTopic,
		// Accept defaults for attempts/timeouts
	}
	producer, err := NewKafkaProducer(kCfg)
	if err != nil {
		t.Fatalf("NewKafkaProducer: %v", err)
	}
	defer func() {
		_ = producer.Close()
	}()

	// S3 archiver
	archiver, err := NewS3Archiver(ctx, s3Bucket, s3Prefix)
	if err != nil {
		t.Fatalf("NewS3Archiver: %v", err)
	}

	// Streamer (we'll call processEvent directly for deterministic flow)
	streamer := NewStreamer(pstore, producer, archiver, StreamerConfig{
		BatchSize:      1,
		PollInterval:   1 * time.Second,
		MaxConcurrency: 1,
	})

	// Create and append an audit event
	ev := &AuditEvent{
		EventType: "integration.test.event",
		Payload: map[string]interface{}{
			"hello": "integration",
		},
		Ts: time.Now().UTC(),
	}

	if err := pstore.AppendAuditEvent(ctx, ev, signClient); err != nil {
		t.Fatalf("AppendAuditEvent failed: %v", err)
	}

	// Process the event (produce -> archive -> mark DB)
	procCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := streamer.processEvent(procCtx, ev); err != nil {
		t.Fatalf("processEvent failed: %v", err)
	}

	// Verify DB row updated: s3_archived_at, kafka_produced_at and stream_status == 'complete'
	var (
		s3Key         sql.NullString
		s3ArchivedAt  sql.NullTime
		kafkaProduced sql.NullTime
		streamStatus  sql.NullString
	)
	row := db.QueryRowContext(ctx, `SELECT s3_object_key, s3_archived_at, kafka_produced_at, stream_status FROM audit_events WHERE id=$1`, ev.ID)
	if err := row.Scan(&s3Key, &s3ArchivedAt, &kafkaProduced, &streamStatus); err != nil {
		t.Fatalf("query audit_events: %v", err)
	}

	if !s3ArchivedAt.Valid {
		t.Fatalf("expected s3_archived_at to be set")
	}
	if !kafkaProduced.Valid {
		t.Fatalf("expected kafka_produced_at to be set")
	}
	if !streamStatus.Valid || streamStatus.String != "complete" {
		t.Fatalf("expected stream_status='complete', got='%v'", streamStatus)
	}

	t.Logf("integration test success: id=%s s3_key=%v s3_archived_at=%v kafka_produced_at=%v",
		ev.ID, s3Key.String, s3ArchivedAt.Time, kafkaProduced.Time)
}
