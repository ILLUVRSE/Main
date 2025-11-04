package audit

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
)

// Producer is the small subset of kafka producer behavior the streamer needs.
type Producer interface {
	Produce(ctx context.Context, key []byte, value []byte) (partition int, offset int64, producedAt time.Time, err error)
	Close() error
}

// StreamerConfig configures the durable DB-first streamer.
type StreamerConfig struct {
	// How many events to fetch per claim
	BatchSize int

	// PollInterval when there is no work (or after a batch)
	PollInterval time.Duration

	// MaxConcurrency bounds concurrent processing of claimed events.
	// Each claimed event is processed (produce->archive) concurrently up to this limit.
	MaxConcurrency int
}

// Streamer implements a durable DB-first audit event streamer that:
//   - selects pending audit_events using SELECT ... FOR UPDATE SKIP LOCKED
//   - claims them (stream_status -> in_progress and increments attempts)
//   - for each event: produce a canonical envelope to Kafka, archive canonical JSON to S3,
//     and mark the event row success/failure so the DB is the source of truth for retries.
type Streamer struct {
	store    *PGStore
	producer Producer
	archiver Archiver
	cfg      StreamerConfig
	// internal
	wg sync.WaitGroup
}

// NewStreamer constructs a streamer. If cfg fields are zero, sensible defaults are used.
func NewStreamer(store *PGStore, producer Producer, archiver Archiver, cfg StreamerConfig) *Streamer {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 10
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 3 * time.Second
	}
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 5
	}
	return &Streamer{
		store:    store,
		producer: producer,
		archiver: archiver,
		cfg:      cfg,
	}
}

// Run starts the streamer loop and blocks until ctx is cancelled. It's safe to run
// in a goroutine if you want non-blocking behavior. The streamer will continue to
// poll for pending work and process batches concurrently up to MaxConcurrency.
func (s *Streamer) Run(ctx context.Context) error {
	log.Printf("[audit.streamer] starting (batch=%d, concurrency=%d)", s.cfg.BatchSize, s.cfg.MaxConcurrency)
	defer log.Printf("[audit.streamer] stopped")

	sem := make(chan struct{}, s.cfg.MaxConcurrency)

	for {
		// Exit if requested
		select {
		case <-ctx.Done():
			// Wait for in-flight workers to finish.
			s.wg.Wait()
			// close producer cleanly
			if s.producer != nil {
				_ = s.producer.Close()
			}
			return ctx.Err()
		default:
		}

		events, err := s.store.FetchPendingEventsForStreaming(ctx, s.cfg.BatchSize)
		if err != nil {
			log.Printf("[audit.streamer] fetch pending: %v", err)
			// backoff before retrying to avoid tight-loop on transient DB problems
			time.Sleep(s.cfg.PollInterval)
			continue
		}

		if len(events) == 0 {
			// nothing to do -> sleep
			time.Sleep(s.cfg.PollInterval)
			continue
		}

		// Process claimed batch with bounded concurrency
		for _, ev := range events {
			// Respect ctx cancellation
			select {
			case <-ctx.Done():
				break
			default:
			}

			sem <- struct{}{}
			s.wg.Add(1)
			go func(ev *AuditEvent) {
				defer func() {
					<-sem
					s.wg.Done()
				}()
				if err := s.processEvent(ctx, ev); err != nil {
					// processEvent already marks DB result; just log
					log.Printf("[audit.streamer] process event %s error: %v", ev.ID, err)
				}
			}(ev)
		}

		// Wait for this batch to complete before fetching more (keeps ordering semantics per batch).
		// Alternatively we could continue fetching, but keeping it simple and bounded.
		// Wait until all slots are free (i.e., drain current batch)
		for i := 0; i < s.cfg.MaxConcurrency; i++ {
			// if there are fewer goroutines than concurrency, this loop will not block long.
			sem <- struct{}{}
		}
		// drain the tokens we added above
		for i := 0; i < s.cfg.MaxConcurrency; i++ {
			<-sem
		}
	}

}

// processEvent performs the produce -> archive sequence for a single event and records
// the result to Postgres via MarkEventStreamResult. It uses reasonable per-operation timeouts.
func (s *Streamer) processEvent(parentCtx context.Context, ev *AuditEvent) error {
	// Per-event deadline to avoid a stuck worker. 30s should be enough for produce+archive locally;
	// tune as required for your infra.
	ctx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
	defer cancel()

	// Build canonical envelope (same structure used by S3Archiver)
	envelope := map[string]interface{}{
		"id":        ev.ID,
		"eventType": ev.EventType,
		"payload":   ev.Payload,
		"prevHash":  ev.PrevHash,
		"hash":      ev.Hash,
		"signature": ev.Signature,
		"signerId":  ev.SignerId,
		"ts":        ev.Ts.Format(time.RFC3339Nano),
		"metadata":  ev.Metadata,
	}

	// Canonical bytes for Kafka production
	canonBytes, err := canonical.MarshalCanonical(envelope)
	if err != nil {
		errMsg := sql.NullString{String: fmt.Sprintf("canonicalize envelope: %v", err), Valid: true}
		_ = s.store.MarkEventStreamResult(parentCtx, ev.ID, sql.NullString{}, false, errMsg)
		return fmt.Errorf("canonicalize envelope: %w", err)
	}

	// Produce to Kafka (key=event.ID)
	_, _, producedAt, err := s.producer.Produce(ctx, []byte(ev.ID), canonBytes)
	if err != nil {
		errMsg := sql.NullString{String: fmt.Sprintf("kafka produce: %v", err), Valid: true}
		_ = s.store.MarkEventStreamResult(parentCtx, ev.ID, sql.NullString{}, false, errMsg)
		return fmt.Errorf("kafka produce: %w", err)
	}

	// Archive to S3. Prefer ArchiveEventAndReturnKey when available to persist the object key.
	var archivedKey sql.NullString
	if s3Arch, ok := s.archiver.(*S3Archiver); ok {
		// Use S3Archiver helper to get object key.
		key, err := s3Arch.ArchiveEventAndReturnKey(ctx, ev)
		if err != nil {
			errMsg := sql.NullString{String: fmt.Sprintf("s3 archive: %v", err), Valid: true}
			_ = s.store.MarkEventStreamResult(parentCtx, ev.ID, sql.NullString{}, false, errMsg)
			return fmt.Errorf("s3 archive: %w", err)
		}
		archivedKey = sql.NullString{String: key, Valid: true}
	} else {
		// Fallback: call Archiver's ArchiveEvent; we won't have the object key in DB.
		if err := s.archiver.ArchiveEvent(ctx, ev); err != nil {
			errMsg := sql.NullString{String: fmt.Sprintf("s3 archive: %v", err), Valid: true}
			_ = s.store.MarkEventStreamResult(parentCtx, ev.ID, sql.NullString{}, false, errMsg)
			return fmt.Errorf("s3 archive: %w", err)
		}
		archivedKey = sql.NullString{Valid: false}
	}

	// Both produce and archive succeeded; mark success in DB.
	if err := s.store.MarkEventStreamResult(parentCtx, ev.ID, archivedKey, true, sql.NullString{}); err != nil {
		// If marking DB failed, we surface error (it will be retried later by worker).
		return fmt.Errorf("mark event stream success: %w", err)
	}

	log.Printf("[audit.streamer] event %s processed: kafka_produced_at=%s archived_key=%v", ev.ID, producedAt.Format(time.RFC3339Nano), archivedKey)
	return nil
}
