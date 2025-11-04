package audit

import (
	"context"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// fakeProducer implements the minimal Producer interface for tests.
type fakeProducer struct {
	produceFunc func(ctx context.Context, key []byte, value []byte) (int, int64, time.Time, error)
}

func (f *fakeProducer) Produce(ctx context.Context, key []byte, value []byte) (int, int64, time.Time, error) {
	if f.produceFunc != nil {
		return f.produceFunc(ctx, key, value)
	}
	return -1, -1, time.Now().UTC(), nil
}

func (f *fakeProducer) Close() error { return nil }

// fakeArchiver implements Archiver for tests.
type fakeArchiver struct {
	archiveFunc func(ctx context.Context, ev *AuditEvent) error
}

func (f *fakeArchiver) ArchiveEvent(ctx context.Context, ev *AuditEvent) error {
	if f.archiveFunc != nil {
		return f.archiveFunc(ctx, ev)
	}
	return nil
}

func TestProcessEvent_Success(t *testing.T) {
	// create sqlmock DB for PGStore
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New error: %v", err)
	}
	defer db.Close()

	pstore := NewPGStore(db)

	// fake producer that succeeds
	prod := &fakeProducer{
		produceFunc: func(ctx context.Context, key []byte, value []byte) (int, int64, time.Time, error) {
			return -1, -1, time.Now().UTC(), nil
		},
	}

	// fake archiver that succeeds
	arch := &fakeArchiver{
		archiveFunc: func(ctx context.Context, ev *AuditEvent) error {
			return nil
		},
	}

	streamer := NewStreamer(pstore, prod, arch, StreamerConfig{
		BatchSize:      1,
		MaxConcurrency: 1,
		PollInterval:   1 * time.Second,
	})

	// build a sample event
	ev := &AuditEvent{
		ID:        "evt-1",
		EventType: "test.event",
		Payload: map[string]interface{}{
			"foo": "bar",
		},
		Ts:        time.Now().UTC(),
		Hash:      "deadbeef",
		Signature: "sig",
		SignerId:  "signer-1",
	}

	// Expect the success-path UPDATE executed by MarkEventStreamResult.
	// The SQL uses two args: (s3_object_key, id). We allow any first arg and match id.
	mock.ExpectExec("UPDATE\\s+audit_events").
		WithArgs(sqlmock.AnyArg(), ev.ID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Run processEvent
	if err := streamer.processEvent(context.Background(), ev); err != nil {
		t.Fatalf("processEvent error: %v", err)
	}

	// ensure expectations met
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestProcessEvent_ProducerFail(t *testing.T) {
	// create sqlmock DB for PGStore
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New error: %v", err)
	}
	defer db.Close()

	pstore := NewPGStore(db)

	// fake producer that fails
	prod := &fakeProducer{
		produceFunc: func(ctx context.Context, key []byte, value []byte) (int, int64, time.Time, error) {
			return -1, -1, time.Time{}, errors.New("producer failure")
		},
	}

	// archiver won't be called in this test because producer fails first,
	// but provide a no-op to be safe.
	arch := &fakeArchiver{
		archiveFunc: func(ctx context.Context, ev *AuditEvent) error { return nil },
	}

	streamer := NewStreamer(pstore, prod, arch, StreamerConfig{
		BatchSize:      1,
		MaxConcurrency: 1,
		PollInterval:   1 * time.Second,
	})

	ev := &AuditEvent{
		ID:        "evt-2",
		EventType: "test.event",
		Payload: map[string]interface{}{
			"hello": "world",
		},
		Ts:        time.Now().UTC(),
		Hash:      "cafebabe",
		Signature: "sig2",
		SignerId:  "signer-2",
	}

	// Expect the failure-path UPDATE executed by MarkEventStreamResult.
	// The SQL uses (last_stream_error, id) as arguments; allow any first arg and match id.
	mock.ExpectExec("UPDATE\\s+audit_events").
		WithArgs(sqlmock.AnyArg(), ev.ID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Run processEvent - should return an error due to producer failure
	if err := streamer.processEvent(context.Background(), ev); err == nil {
		t.Fatalf("expected error from processEvent due to producer failure, got nil")
	}

	// ensure expectations met
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
