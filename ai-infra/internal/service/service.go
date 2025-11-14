package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/models"
	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/signing"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

type Service struct {
	store    store.Store
	sentinel sentinel.Client
	signer   signing.Signer
}

func New(store store.Store, sentinel sentinel.Client, signer signing.Signer) *Service {
	return &Service{
		store:    store,
		sentinel: sentinel,
		signer:   signer,
	}
}

type TrainingJobRequest struct {
	CodeRef         string          `json:"codeRef"`
	ContainerDigest string          `json:"containerDigest"`
	Hyperparams     json.RawMessage `json:"hyperparams"`
	DatasetRefs     json.RawMessage `json:"datasetRefs"`
	Seed            int64           `json:"seed"`
}

func (s *Service) CreateTrainingJob(ctx context.Context, req TrainingJobRequest) (models.TrainingJob, error) {
	if req.CodeRef == "" || req.ContainerDigest == "" {
		return models.TrainingJob{}, fmt.Errorf("codeRef and containerDigest required")
	}
	if req.Seed == 0 {
		req.Seed = time.Now().UnixNano()
	}
	return s.store.CreateTrainingJob(ctx, store.TrainingJobInput{
		CodeRef:         req.CodeRef,
		ContainerDigest: req.ContainerDigest,
		Hyperparams:     req.Hyperparams,
		DatasetRefs:     req.DatasetRefs,
		Seed:            req.Seed,
		Status:          "queued",
	})
}

type RegisterArtifactRequest struct {
	TrainingJobID       uuid.UUID       `json:"trainingJobId"`
	ArtifactURI         string          `json:"artifactUri"`
	Checksum            string          `json:"checksum"`
	Metadata            json.RawMessage `json:"metadata"`
	ManifestSignatureID *string         `json:"manifestSignatureId"`
}

func (s *Service) RegisterArtifact(ctx context.Context, req RegisterArtifactRequest) (models.ModelArtifact, error) {
	if req.TrainingJobID == uuid.Nil || req.ArtifactURI == "" || req.Checksum == "" {
		return models.ModelArtifact{}, fmt.Errorf("trainingJobId, artifactUri, and checksum required")
	}
	payload := map[string]interface{}{
		"trainingJobId": req.TrainingJobID.String(),
		"artifactUri":   req.ArtifactURI,
		"checksum":      req.Checksum,
	}
	if len(req.Metadata) > 0 {
		payload["metadata"] = json.RawMessage(req.Metadata)
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return models.ModelArtifact{}, err
	}
	hash := sha256.Sum256(serialized)
	sigBytes, err := s.signer.Sign(ctx, hash[:])
	if err != nil {
		return models.ModelArtifact{}, fmt.Errorf("sign artifact: %w", err)
	}
	signature := base64.StdEncoding.EncodeToString(sigBytes)

	return s.store.CreateArtifact(ctx, store.ArtifactInput{
		TrainingJobID:       req.TrainingJobID,
		ArtifactURI:         req.ArtifactURI,
		Checksum:            req.Checksum,
		Metadata:            req.Metadata,
		SignerID:            s.signer.SignerID(),
		Signature:           signature,
		ManifestSignatureID: req.ManifestSignatureID,
	})
}

type PromotionRequest struct {
	ArtifactID  uuid.UUID       `json:"artifactId"`
	Environment string          `json:"environment"`
	Evaluation  json.RawMessage `json:"evaluation"`
	RequestedBy string          `json:"requestedBy"`
}

func (s *Service) PromoteArtifact(ctx context.Context, req PromotionRequest) (models.ModelPromotion, error) {
	if req.ArtifactID == uuid.Nil || req.Environment == "" {
		return models.ModelPromotion{}, fmt.Errorf("artifactId and environment required")
	}
	if req.RequestedBy == "" {
		req.RequestedBy = "ai-infra"
	}
	// Ensure artifact exists
	if _, err := s.store.GetArtifact(ctx, req.ArtifactID); err != nil {
		return models.ModelPromotion{}, err
	}
	promo, err := s.store.CreatePromotion(ctx, store.PromotionInput{
		ArtifactID:  req.ArtifactID,
		Environment: req.Environment,
		Status:      "pending",
		Evaluation:  req.Evaluation,
	})
	if err != nil {
		return models.ModelPromotion{}, err
	}

	decision := sentinel.Decision{Allowed: true, PolicyID: "sentinel-allow", Reason: "default"}
	if s.sentinel != nil {
		var eval map[string]float64
		_ = json.Unmarshal(req.Evaluation, &eval)
		decision, err = s.sentinel.Check(ctx, sentinel.Request{
			ArtifactID:  req.ArtifactID.String(),
			Environment: req.Environment,
			Evaluation:  eval,
		})
		if err != nil {
			return promo, err
		}
	}

	status := "applied"
	if !decision.Allowed {
		status = "rejected"
	}
	var signature *string
	var signerID *string
	var promotedAt *time.Time
	if decision.Allowed {
		payload := map[string]interface{}{
			"artifactId":  req.ArtifactID.String(),
			"environment": req.Environment,
			"evaluation":  json.RawMessage(req.Evaluation),
			"requestedBy": req.RequestedBy,
		}
		bytes, _ := json.Marshal(payload)
		hash := sha256.Sum256(bytes)
		sigBytes, err := s.signer.Sign(ctx, hash[:])
		if err != nil {
			return promo, fmt.Errorf("sign promotion: %w", err)
		}
		sigStr := base64.StdEncoding.EncodeToString(sigBytes)
		signature = &sigStr
		id := s.signer.SignerID()
		signerID = &id
		now := time.Now().UTC()
		promotedAt = &now
	}

	updated, err := s.store.UpdatePromotionStatus(ctx, store.PromotionStatusUpdate{
		ID:               promo.ID,
		Status:           status,
		SentinelDecision: sentinel.MarshalDecision(decision),
		PromotedBy:       req.RequestedBy,
		PromotedAt:       promotedAt,
		Signature:        signature,
		SignerID:         signerID,
	})
	if err != nil {
		return promo, err
	}
	return updated, nil
}
