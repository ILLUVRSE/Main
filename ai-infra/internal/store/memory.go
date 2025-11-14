package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sort"
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
	now := time.Now().UTC()
	job := models.TrainingJob{
		ID:              in.ID,
		CodeRef:         in.CodeRef,
		ContainerDigest: in.ContainerDigest,
		Hyperparams:     copyJSON(in.Hyperparams, "{}"),
		DatasetRefs:     copyJSON(in.DatasetRefs, "[]"),
		Seed:            in.Seed,
		Status:          in.Status,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jobs[job.ID] = job
	return job, nil
}

func (m *MemoryStore) GetTrainingJob(ctx context.Context, id uuid.UUID) (models.TrainingJob, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok {
		return models.TrainingJob{}, ErrNotFound
	}
	return job, nil
}

func (m *MemoryStore) ClaimNextTrainingJob(ctx context.Context) (models.TrainingJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var (
		selectedID uuid.UUID
		selected   models.TrainingJob
		found      bool
	)
	for id, job := range m.jobs {
		if job.Status != "queued" {
			continue
		}
		if !found || job.CreatedAt.Before(selected.CreatedAt) {
			selectedID = id
			selected = job
			found = true
		}
	}
	if !found {
		return models.TrainingJob{}, ErrNotFound
	}
	now := time.Now().UTC()
	selected.Status = "running"
	selected.UpdatedAt = now
	m.jobs[selectedID] = selected
	return selected, nil
}

func (m *MemoryStore) UpdateTrainingJobStatus(ctx context.Context, id uuid.UUID, status string) (models.TrainingJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[id]
	if !ok {
		return models.TrainingJob{}, ErrNotFound
	}
	job.Status = status
	job.UpdatedAt = time.Now().UTC()
	m.jobs[id] = job
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

func (m *MemoryStore) ListArtifacts(ctx context.Context, filter ListArtifactsFilter) ([]models.ModelArtifact, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var artifacts []models.ModelArtifact
	for _, artifact := range m.artifacts {
		if filter.TrainingJobID != nil && artifact.TrainingJobID != *filter.TrainingJobID {
			continue
		}
		if filter.Checksum != "" && artifact.Checksum != filter.Checksum {
			continue
		}
		artifacts = append(artifacts, artifact)
	}
	sort.Slice(artifacts, func(i, j int) bool {
		return artifacts[i].CreatedAt.After(artifacts[j].CreatedAt)
	})
	start := filter.Offset
	if start > len(artifacts) {
		start = len(artifacts)
	}
	if start < 0 {
		start = 0
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	end := start + limit
	if end > len(artifacts) {
		end = len(artifacts)
	}
	result := make([]models.ModelArtifact, end-start)
	copy(result, artifacts[start:end])
	return result, nil
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

func (m *MemoryStore) ListPromotionsByArtifact(ctx context.Context, artifactID uuid.UUID) ([]models.ModelPromotion, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var promotions []models.ModelPromotion
	for _, promo := range m.promotions {
		if promo.ArtifactID == artifactID {
			promotions = append(promotions, promo)
		}
	}
	sort.Slice(promotions, func(i, j int) bool {
		return promotions[i].CreatedAt.After(promotions[j].CreatedAt)
	})
	result := make([]models.ModelPromotion, len(promotions))
	copy(result, promotions)
	return result, nil
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
