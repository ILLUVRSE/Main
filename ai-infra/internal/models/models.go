package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type TrainingJob struct {
	ID              uuid.UUID       `json:"id"`
	CodeRef         string          `json:"codeRef"`
	ContainerDigest string          `json:"containerDigest"`
	Hyperparams     json.RawMessage `json:"hyperparams"`
	DatasetRefs     json.RawMessage `json:"datasetRefs"`
	Seed            int64           `json:"seed"`
	Status          string          `json:"status"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type ModelArtifact struct {
	ID                  uuid.UUID       `json:"id"`
	TrainingJobID       uuid.UUID       `json:"trainingJobId"`
	ArtifactURI         string          `json:"artifactUri"`
	Checksum            string          `json:"checksum"`
	Metadata            json.RawMessage `json:"metadata"`
	SignerID            string          `json:"signerId"`
	Signature           string          `json:"signature"`
	ManifestSignatureID *string         `json:"manifestSignatureId,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`
}

type ModelPromotion struct {
	ID               uuid.UUID       `json:"id"`
	ArtifactID       uuid.UUID       `json:"artifactId"`
	Environment      string          `json:"environment"`
	Status           string          `json:"status"`
	Evaluation       json.RawMessage `json:"evaluation"`
	SentinelDecision json.RawMessage `json:"sentinelDecision,omitempty"`
	PromotedBy       string          `json:"promotedBy,omitempty"`
	PromotedAt       *time.Time      `json:"promotedAt,omitempty"`
	Signature        *string         `json:"signature,omitempty"`
	SignerID         *string         `json:"signerId,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
}
