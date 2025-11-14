package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/models"
)

type MemoryStore struct {
	mu         sync.RWMutex
	jobs       map[uuid.UUID]models.TrainingJob
	artifacts  map[uuid.UUID]models.ModelArtifact
	promotions map[uuid.UUID]models.ModelPromotion
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		jobs:       map[uuid.UUID]models.TrainingJob{},
		artifacts:  map[uuid.UUID]models.ModelArtifact{},
		promotions: map[uuid.UUID]models.ModelPromotion{},
	}
}

func copyJSON(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(fallback)
	}
	return append(json.RawMessage(nil), raw...)
}

func (m *MemoryStore) CreateTrainingJob(ctx context.Context, in TrainingJobInput) (models.TrainingJob, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	job := models.TrainingJob{
		ID:              in.ID,
		CodeRef:         in.CodeRef,
		ContainerDigest: in.ContainerDigest,
		Hyperparams:     copyJSON(in.Hyperparams, "{}"),
		DatasetRefs:     copyJSON(in.DatasetRefs, "[]"),
		Seed:            in.Seed,
		Status:          in.Status,
		CreatedAt:       time.Now().UTC(),
		UpdatedAt:       time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jobs[job.ID] = job
	return job, nil
}

func (m *MemoryStore) CreateArtifact(ctx context.Context, in ArtifactInput) (models.ModelArtifact, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	if _, err := uuid.Parse(in.TrainingJobID.String()); err != nil {
		return models.ModelArtifact{}, err
	}
	artifact := models.ModelArtifact{
		ID:                  in.ID,
		TrainingJobID:       in.TrainingJobID,
		ArtifactURI:         in.ArtifactURI,
		Checksum:            in.Checksum,
		Metadata:            copyJSON(in.Metadata, "{}"),
		SignerID:            in.SignerID,
		Signature:           in.Signature,
		ManifestSignatureID: in.ManifestSignatureID,
		CreatedAt:           time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.artifacts[artifact.ID] = artifact
	return artifact, nil
}

func (m *MemoryStore) GetArtifact(ctx context.Context, id uuid.UUID) (models.ModelArtifact, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	artifact, ok := m.artifacts[id]
	if !ok {
		return models.ModelArtifact{}, ErrNotFound
	}
	return artifact, nil
}

func (m *MemoryStore) CreatePromotion(ctx context.Context, in PromotionInput) (models.ModelPromotion, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	promo := models.ModelPromotion{
		ID:          in.ID,
		ArtifactID:  in.ArtifactID,
		Environment: in.Environment,
		Status:      in.Status,
		Evaluation:  copyJSON(in.Evaluation, "{}"),
		CreatedAt:   time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.promotions[promo.ID] = promo
	return promo, nil
}

func (m *MemoryStore) UpdatePromotionStatus(ctx context.Context, in PromotionStatusUpdate) (models.ModelPromotion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	promo, ok := m.promotions[in.ID]
	if !ok {
		return models.ModelPromotion{}, ErrNotFound
	}
	promo.Status = in.Status
	if len(in.SentinelDecision) > 0 {
		promo.SentinelDecision = copyJSON(in.SentinelDecision, "{}")
	}
	promo.PromotedBy = in.PromotedBy
	if in.PromotedAt != nil {
		promo.PromotedAt = in.PromotedAt
	}
	if in.Signature != nil {
		sig := *in.Signature
		promo.Signature = &sig
	}
	if in.SignerID != nil {
		id := *in.SignerID
		promo.SignerID = &id
	}
	m.promotions[in.ID] = promo
	return promo, nil
}

func (m *MemoryStore) Ping(ctx context.Context) error { return nil }

// Ensures imports used (base64) for gofmt.
var _ = base64.StdEncoding
