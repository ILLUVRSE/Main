package audit

import (
	"bytes"
	"context"
	"fmt"
	"path"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsConfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Archiver uploads canonical audit event JSON to object storage (S3).
type Archiver interface {
	ArchiveEvent(ctx context.Context, ev *AuditEvent) error
}

// S3Archiver writes canonicalized audit events to S3 paths like:
//
//	s3://<bucket>/<prefix>/audit/YYYY/MM/DD/<eventID>.json
type S3Archiver struct {
	bucket   string
	prefix   string
	client   *s3.Client
	uploader *manager.Uploader
}

// NewS3Archiver creates an S3Archiver. If region/credentials are provided via environment
// (AWS_REGION, AWS_PROFILE, AWS_ACCESS_KEY_ID/SECRET etc.), the SDK will pick them up.
// The prefix may be empty or a leading path (no leading slash required).
func NewS3Archiver(ctx context.Context, bucket string, prefix string) (*S3Archiver, error) {
	if bucket == "" {
		return nil, fmt.Errorf("bucket required")
	}
	cfg, err := awsConfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	client := s3.NewFromConfig(cfg)
	uploader := manager.NewUploader(client)

	a := &S3Archiver{
		bucket:   bucket,
		prefix:   prefix,
		client:   client,
		uploader: uploader,
	}
	return a, nil
}

// ArchiveEvent canonicalizes a full event envelope and uploads to S3.
// The stored object is the canonical JSON of a small envelope:
//
//	{ id, eventType, payload, prevHash, hash, signature, signerId, ts, metadata }
func (s *S3Archiver) ArchiveEvent(ctx context.Context, ev *AuditEvent) error {
	if ev == nil {
		return fmt.Errorf("nil event")
	}

	// Build canonical envelope
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

	// Canonicalize envelope bytes
	canonBytes, err := canonical.MarshalCanonical(envelope)
	if err != nil {
		return fmt.Errorf("canonicalize envelope: %w", err)
	}

	// Use event timestamp for path if present; otherwise now.
	ts := time.Now().UTC()
	if !ev.Ts.IsZero() {
		ts = ev.Ts
	}
	year, month, day := ts.Date()
	objectKey := path.Join(s.prefix, "audit",
		fmt.Sprintf("%04d", year),
		fmt.Sprintf("%02d", int(month)),
		fmt.Sprintf("%02d", day),
		fmt.Sprintf("%s.json", ev.ID),
	)

	// Prepare upload input
	upParams := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(objectKey),
		Body:        bytes.NewReader(canonBytes),
		ContentType: aws.String("application/json"),
		// Server-side encryption with S3-managed keys (SSE-S3).
		ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	}

	// Upload using manager.Uploader for concurrency and retries
	_, err = s.uploader.Upload(ctx, upParams)
	if err != nil {
		return fmt.Errorf("s3 upload failed: %w", err)
	}
	return nil
}

// Convenience helper: ArchiveEventAndReturnKey returns the object key after upload.
// It's implemented by calling ArchiveEvent and composing the key; useful for callers that
// want to persist the S3 pointer in DB or audit metadata.
func (s *S3Archiver) ArchiveEventAndReturnKey(ctx context.Context, ev *AuditEvent) (string, error) {
	if ev == nil {
		return "", fmt.Errorf("nil event")
	}
	// Determine ts and objectKey same as ArchiveEvent
	ts := time.Now().UTC()
	if !ev.Ts.IsZero() {
		ts = ev.Ts
	}
	year, month, day := ts.Date()
	objectKey := path.Join(s.prefix, "audit",
		fmt.Sprintf("%04d", year),
		fmt.Sprintf("%02d", int(month)),
		fmt.Sprintf("%02d", day),
		fmt.Sprintf("%s.json", ev.ID),
	)

	// Call ArchiveEvent (does canonicalization + upload)
	if err := s.ArchiveEvent(ctx, ev); err != nil {
		return "", err
	}
	return objectKey, nil
}
