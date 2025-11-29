package model

import (
	"time"
)

type PromotionStatus string

const (
	PromotionStatusPending  PromotionStatus = "pending"
	PromotionStatusAccepted PromotionStatus = "accepted"
	PromotionStatusFailed   PromotionStatus = "failed"
)

type Promotion struct {
	ID             string                 `json:"id"`
	ArtifactID     string                 `json:"artifact_id"`
	Reason         string                 `json:"reason"`
	Score          float64                `json:"score"`
	Status         PromotionStatus        `json:"status"`
	TargetEnv      string                 `json:"target_env"`
	TrafficPercent int                    `json:"traffic_percent"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
	AuditContext   map[string]interface{} `json:"audit_context"`
	Metadata       map[string]interface{} `json:"metadata"`
	EventID        string                 `json:"event_id,omitempty"` // Reasoning Graph Event ID
}

type Allocation struct {
	ID             string                 `json:"id"`
	EntityID       string                 `json:"entity_id"`
	Status         string                 `json:"status"`
	Resources      map[string]interface{} `json:"resources"`
	LedgerProofID  string                 `json:"ledger_proof_id,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
}
