package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
)

// KafkaProducerConfig contains configurable parameters for the Kafka producer.
type KafkaProducerConfig struct {
	// Brokers is the list of Kafka broker addresses (host:port).
	Brokers []string

	// Topic is the default topic to write to.
	Topic string

	// MaxAttempts is how many times the producer will retry a Produce on transient error.
	// Defaults to 3 if <= 0.
	MaxAttempts int

	// WriteTimeout is the per-attempt timeout for Write operations.
	// Defaults to 10s if zero.
	WriteTimeout time.Duration

	// Balancer decides partition selection. If nil, a Hash balancer is used (key-based).
	Balancer kafka.Balancer
}

// KafkaProducer is a lightweight wrapper over segmentio/kafka-go Writer that offers
// simple, testable produce-with-retries behavior for use by the audit streamer.
//
// Note: kafka-go's high-level Writer API does not return partition/offsets for produced
// messages. If you need exact partition/offsets persisted, consider using kafka.Conn
// and writing to a specific leader partition (more complex) — for our DB-first
// pipeline we persist produced timestamps and let offsets be optional (set by a later
// enhancement if required).
type KafkaProducer struct {
	writer      *kafka.Writer
	topic       string
	maxAttempts int
}

// NewKafkaProducer constructs a KafkaProducer.
// - brokers: list of "host:port"
// - topic: default topic
// Returns an error if required params are missing.
func NewKafkaProducer(cfg KafkaProducerConfig) (*KafkaProducer, error) {
	if len(cfg.Brokers) == 0 {
		return nil, fmt.Errorf("kafka: at least one broker required")
	}
	if cfg.Topic == "" {
		return nil, fmt.Errorf("kafka: topic required")
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 10 * time.Second
	}
	if cfg.Balancer == nil {
		// Use key-hash balancer by default; this makes messages with the same key
		// go to the same partition (useful for ordering by key).
		cfg.Balancer = &kafka.Hash{}
	}

	w := kafka.NewWriter(kafka.WriterConfig{
		Brokers:      cfg.Brokers,
		Topic:        cfg.Topic,
		Balancer:     cfg.Balancer,
		BatchTimeout: 10 * time.Millisecond,
		WriteTimeout: cfg.WriteTimeout,
		// Async=false ensures WriteMessages returns after the message was
		// acknowledged by the writer pipeline (within WriteTimeout).
		Async: false,
	})

	return &KafkaProducer{
		writer:      w,
		topic:       cfg.Topic,
		maxAttempts: cfg.MaxAttempts,
	}, nil
}

// Produce writes a single message with optional key and value bytes. On success,
// it returns producedAt timestamp. Partition and offset are returned as -1 by this
// wrapper (see file comment for rationale).
//
// If the produce ultimately fails after retries, a non-nil error is returned.
func (p *KafkaProducer) Produce(ctx context.Context, key []byte, value []byte) (partition int, offset int64, producedAt time.Time, err error) {
	var lastErr error
	backoff := 100 * time.Millisecond

	for attempt := 1; attempt <= p.maxAttempts; attempt++ {
		// Note: kafka-go Writer writes the message to the configured topic.
		msg := kafka.Message{
			Key:   key,
			Value: value,
			Time:  time.Now().UTC(),
		}

		// Per-attempt context with timeout to avoid indefinite hangs.
		attemptTimeout := 5 * time.Second
		ctxAttempt, cancel := context.WithTimeout(ctx, attemptTimeout)
		err := p.writer.WriteMessages(ctxAttempt, msg)
		cancel()

		if err == nil {
			// Writer does not return partition/offset here. Return producedAt timestamp.
			return -1, -1, msg.Time, nil
		}

		// keep last error and retry after backoff
		lastErr = err
		// simple exponential backoff with cap
		time.Sleep(backoff)
		if backoff < 2*time.Second {
			backoff *= 2
		}
	}

	return -1, -1, time.Time{}, fmt.Errorf("produce failed after %d attempts: %w", p.maxAttempts, lastErr)
}

// ProduceJSON marshals v into compact JSON and produces it as the message value.
// key may be nil/empty.
func (p *KafkaProducer) ProduceJSON(ctx context.Context, key []byte, v interface{}) (int, int64, time.Time, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return -1, -1, time.Time{}, fmt.Errorf("marshal json: %w", err)
	}
	return p.Produce(ctx, key, b)
}

// Close shuts down the underlying writer and releases resources.
func (p *KafkaProducer) Close() error {
	if p == nil || p.writer == nil {
		return nil
	}
	return p.writer.Close()
}
