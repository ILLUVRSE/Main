package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/models"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	CreateTrainingJob(ctx context.Context, in TrainingJobInput) (models.TrainingJob, error)
	GetTrainingJob(ctx context.Context, id uuid.UUID) (models.TrainingJob, error)
	ClaimNextTrainingJob(ctx context.Context) (models.TrainingJob, error)
	UpdateTrainingJobStatus(ctx context.Context, id uuid.UUID, status string) (models.TrainingJob, error)
	CreateArtifact(ctx context.Context, in ArtifactInput) (models.ModelArtifact, error)
	ListArtifacts(ctx context.Context, filter ListArtifactsFilter) ([]models.ModelArtifact, error)
	GetArtifact(ctx context.Context, id uuid.UUID) (models.ModelArtifact, error)
	CreatePromotion(ctx context.Context, in PromotionInput) (models.ModelPromotion, error)
	ListPromotionsByArtifact(ctx context.Context, artifactID uuid.UUID) ([]models.ModelPromotion, error)
	UpdatePromotionStatus(ctx context.Context, in PromotionStatusUpdate) (models.ModelPromotion, error)
	Ping(ctx context.Context) error
}

type PGStore struct {
	db *sql.DB
}

func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

type TrainingJobInput struct {
	ID              uuid.UUID
	CodeRef         string
	ContainerDigest string
	Hyperparams     json.RawMessage
	DatasetRefs     json.RawMessage
	Seed            int64
	Status          string
}

type ArtifactInput struct {
	ID                  uuid.UUID
	TrainingJobID       uuid.UUID
	ArtifactURI         string
	Checksum            string
	Metadata            json.RawMessage
	SignerID            string
	Signature           string
	ManifestSignatureID *string
}

type PromotionInput struct {
	ID          uuid.UUID
	ArtifactID  uuid.UUID
	Environment string
	Status      string
	Evaluation  json.RawMessage
}

type PromotionStatusUpdate struct {
	ID               uuid.UUID
	Status           string
	SentinelDecision json.RawMessage
	PromotedBy       string
	PromotedAt       *time.Time
	Signature        *string
	SignerID         *string
}

type ListArtifactsFilter struct {
	TrainingJobID *uuid.UUID
	Checksum      string
	Limit         int
	Offset        int
}

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func ensureJSON(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(fallback)
	}
	return raw
}

func scanTrainingJob(row rowScanner) (models.TrainingJob, error) {
	var (
		job         models.TrainingJob
		hyperparams []byte
		datasetRefs []byte
	)
	if err := row.Scan(
		&job.ID,
		&job.CodeRef,
		&job.ContainerDigest,
		&hyperparams,
		&datasetRefs,
		&job.Seed,
		&job.Status,
		&job.CreatedAt,
		&job.UpdatedAt,
	); err != nil {
		return models.TrainingJob{}, err
	}
	job.Hyperparams = append(json.RawMessage(nil), hyperparams...)
	job.DatasetRefs = append(json.RawMessage(nil), datasetRefs...)
	return job, nil
}

func scanArtifact(row rowScanner) (models.ModelArtifact, error) {
	var (
		artifact models.ModelArtifact
		metadata []byte
		manifest sql.NullString
	)
	if err := row.Scan(
		&artifact.ID,
		&artifact.TrainingJobID,
		&artifact.ArtifactURI,
		&artifact.Checksum,
		&metadata,
		&artifact.SignerID,
		&artifact.Signature,
		&manifest,
		&artifact.CreatedAt,
	); err != nil {
		return models.ModelArtifact{}, err
	}
	artifact.Metadata = append(json.RawMessage(nil), metadata...)
	if manifest.Valid {
		artifact.ManifestSignatureID = &manifest.String
	}
	return artifact, nil
}

func scanPromotion(row rowScanner) (models.ModelPromotion, error) {
	var (
		promo      models.ModelPromotion
		evalBytes  []byte
		sentinel   []byte
		promotedAt sql.NullTime
		signature  sql.NullString
		signer     sql.NullString
	)
	if err := row.Scan(
		&promo.ID,
		&promo.ArtifactID,
		&promo.Environment,
		&promo.Status,
		&evalBytes,
		&sentinel,
		&promo.PromotedBy,
		&promotedAt,
		&signature,
		&signer,
		&promo.CreatedAt,
	); err != nil {
		return models.ModelPromotion{}, err
	}
	promo.Evaluation = append(json.RawMessage(nil), evalBytes...)
	if len(sentinel) > 0 {
		promo.SentinelDecision = append(json.RawMessage(nil), sentinel...)
	}
	if promotedAt.Valid {
		t := promotedAt.Time
		promo.PromotedAt = &t
	}
	if signature.Valid {
		v := signature.String
		promo.Signature = &v
	}
	if signer.Valid {
		v := signer.String
		promo.SignerID = &v
	}
	return promo, nil
}

func (s *PGStore) CreateTrainingJob(ctx context.Context, in TrainingJobInput) (models.TrainingJob, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO training_jobs (id, code_ref, container_digest, hyperparams, dataset_refs, seed, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, code_ref, container_digest, hyperparams, dataset_refs, seed, status, created_at, updated_at
	`
	row := s.db.QueryRowContext(ctx, query, in.ID, in.CodeRef, in.ContainerDigest, ensureJSON(in.Hyperparams, "{}"), ensureJSON(in.DatasetRefs, "[]"), in.Seed, in.Status)
	job, err := scanTrainingJob(row)
	if err != nil {
		return models.TrainingJob{}, fmt.Errorf("insert training job: %w", err)
	}
	return job, nil
}

func (s *PGStore) GetTrainingJob(ctx context.Context, id uuid.UUID) (models.TrainingJob, error) {
	const query = `
		SELECT id, code_ref, container_digest, hyperparams, dataset_refs, seed, status, created_at, updated_at
		FROM training_jobs WHERE id=$1
	`
	job, err := scanTrainingJob(s.db.QueryRowContext(ctx, query, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.TrainingJob{}, ErrNotFound
		}
		return models.TrainingJob{}, fmt.Errorf("get training job: %w", err)
	}
	return job, nil
}

func (s *PGStore) ClaimNextTrainingJob(ctx context.Context) (models.TrainingJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.TrainingJob{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	const selectQueued = `
		SELECT id FROM training_jobs
		WHERE status='queued'
		ORDER BY created_at
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`
	var jobID uuid.UUID
	if err := tx.QueryRowContext(ctx, selectQueued).Scan(&jobID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.TrainingJob{}, ErrNotFound
		}
		return models.TrainingJob{}, fmt.Errorf("select queued job: %w", err)
	}

	const claimQuery = `
		UPDATE training_jobs
		SET status='running', updated_at=NOW()
		WHERE id=$1
		RETURNING id, code_ref, container_digest, hyperparams, dataset_refs, seed, status, created_at, updated_at
	`
	job, err := scanTrainingJob(tx.QueryRowContext(ctx, claimQuery, jobID))
	if err != nil {
		return models.TrainingJob{}, fmt.Errorf("claim job: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return models.TrainingJob{}, fmt.Errorf("commit claim: %w", err)
	}
	return job, nil
}

func (s *PGStore) UpdateTrainingJobStatus(ctx context.Context, id uuid.UUID, status string) (models.TrainingJob, error) {
	const query = `
		UPDATE training_jobs
		SET status=$2, updated_at=NOW()
		WHERE id=$1
		RETURNING id, code_ref, container_digest, hyperparams, dataset_refs, seed, status, created_at, updated_at
	`
	job, err := scanTrainingJob(s.db.QueryRowContext(ctx, query, id, status))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.TrainingJob{}, ErrNotFound
		}
		return models.TrainingJob{}, fmt.Errorf("update training job: %w", err)
	}
	return job, nil
}

func (s *PGStore) CreateArtifact(ctx context.Context, in ArtifactInput) (models.ModelArtifact, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO model_artifacts (id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id, created_at
	`
	row := s.db.QueryRowContext(ctx, query, in.ID, in.TrainingJobID, in.ArtifactURI, in.Checksum, ensureJSON(in.Metadata, "{}"), in.SignerID, in.Signature, in.ManifestSignatureID)
	artifact, err := scanArtifact(row)
	if err != nil {
		return models.ModelArtifact{}, fmt.Errorf("insert model artifact: %w", err)
	}
	return artifact, nil
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func (s *PGStore) ListArtifacts(ctx context.Context, filter ListArtifactsFilter) ([]models.ModelArtifact, error) {
	query := `
		SELECT id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id, created_at
		FROM model_artifacts
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1
	if filter.TrainingJobID != nil {
		query += fmt.Sprintf(" AND training_job_id = $%d", argPos)
		args = append(args, *filter.TrainingJobID)
		argPos++
	}
	if filter.Checksum != "" {
		query += fmt.Sprintf(" AND checksum = $%d", argPos)
		args = append(args, filter.Checksum)
		argPos++
	}
	query += " ORDER BY created_at DESC"
	limit := normalizeLimit(filter.Limit)
	query += fmt.Sprintf(" LIMIT $%d", argPos)
	args = append(args, limit)
	argPos++
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", argPos)
		args = append(args, offset)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list artifacts: %w", err)
	}
	defer rows.Close()

	var artifacts []models.ModelArtifact
	for rows.Next() {
		artifact, err := scanArtifact(rows)
		if err != nil {
			return nil, fmt.Errorf("scan artifact: %w", err)
		}
		artifacts = append(artifacts, artifact)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate artifacts: %w", err)
	}
	return artifacts, nil
}

func (s *PGStore) GetArtifact(ctx context.Context, id uuid.UUID) (models.ModelArtifact, error) {
	const query = `
		SELECT id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id, created_at
		FROM model_artifacts
		WHERE id = $1
	`
	artifact, err := scanArtifact(s.db.QueryRowContext(ctx, query, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ModelArtifact{}, ErrNotFound
		}
		return models.ModelArtifact{}, fmt.Errorf("get artifact: %w", err)
	}
	return artifact, nil
}

func (s *PGStore) CreatePromotion(ctx context.Context, in PromotionInput) (models.ModelPromotion, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO model_promotions (id, artifact_id, environment, status, evaluation)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, artifact_id, environment, status, evaluation, sentinel_decision, promoted_by, promoted_at, signature, signer_id, created_at
	`
	row := s.db.QueryRowContext(ctx, query, in.ID, in.ArtifactID, in.Environment, in.Status, ensureJSON(in.Evaluation, "{}"))
	promo, err := scanPromotion(row)
	if err != nil {
		return models.ModelPromotion{}, fmt.Errorf("insert promotion: %w", err)
	}
	return promo, nil
}

func (s *PGStore) ListPromotionsByArtifact(ctx context.Context, artifactID uuid.UUID) ([]models.ModelPromotion, error) {
	const query = `
		SELECT id, artifact_id, environment, status, evaluation, sentinel_decision, promoted_by, promoted_at, signature, signer_id, created_at
		FROM model_promotions
		WHERE artifact_id = $1
		ORDER BY created_at DESC
	`
	rows, err := s.db.QueryContext(ctx, query, artifactID)
	if err != nil {
		return nil, fmt.Errorf("list promotions: %w", err)
	}
	defer rows.Close()

	var promotions []models.ModelPromotion
	for rows.Next() {
		promo, err := scanPromotion(rows)
		if err != nil {
			return nil, fmt.Errorf("scan promotion: %w", err)
		}
		promotions = append(promotions, promo)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate promotions: %w", err)
	}
	return promotions, nil
}

func (s *PGStore) UpdatePromotionStatus(ctx context.Context, in PromotionStatusUpdate) (models.ModelPromotion, error) {
	query := `
		UPDATE model_promotions
		SET status=$2,
		    sentinel_decision=$3,
		    promoted_by=$4,
		    promoted_at=$5,
		    signature=$6,
		    signer_id=$7
		WHERE id=$1
		RETURNING id, artifact_id, environment, status, evaluation, sentinel_decision, promoted_by, promoted_at, signature, signer_id, created_at
	`
	row := s.db.QueryRowContext(ctx, query, in.ID, in.Status, in.SentinelDecision, in.PromotedBy, in.PromotedAt, in.Signature, in.SignerID)
	promo, err := scanPromotion(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ModelPromotion{}, ErrNotFound
		}
		return models.ModelPromotion{}, fmt.Errorf("update promotion status: %w", err)
	}
	return promo, nil
}

func (s *PGStore) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	return nil
}
