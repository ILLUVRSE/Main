package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type EvalReport struct {
	ID        uuid.UUID       `json:"id"`
	AgentID   string          `json:"agentId"`
	MetricSet json.RawMessage `json:"metricSet"`
	Source    string          `json:"source,omitempty"`
	Tags      json.RawMessage `json:"tags,omitempty"`
	TS        time.Time       `json:"ts"`
	CreatedAt time.Time       `json:"createdAt"`
}

type AgentScore struct {
	AgentID    string          `json:"agentId"`
	Score      float64         `json:"score"`
	Components json.RawMessage `json:"components"`
	Confidence float64         `json:"confidence"`
	Window     string          `json:"window"`
	ComputedAt time.Time       `json:"computedAt"`
}

type PromotionEvent struct {
	ID                  uuid.UUID  `json:"id"`
	AgentID             string     `json:"agentId"`
	Action              string     `json:"action"`
	Rationale           string     `json:"rationale"`
	Confidence          float64    `json:"confidence"`
	Status              string     `json:"status"`
	RequestedBy         string     `json:"requestedBy"`
	AllocationRequestID *uuid.UUID `json:"allocationRequestId,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
}

type AllocationRequest struct {
	ID               uuid.UUID       `json:"id"`
	PromotionID      *uuid.UUID      `json:"promotionId,omitempty"`
	AgentID          string          `json:"agentId"`
	Pool             string          `json:"pool"`
	Delta            int             `json:"delta"`
	Reason           string          `json:"reason"`
	Status           string          `json:"status"`
	SentinelDecision json.RawMessage `json:"sentinelDecision,omitempty"`
	RequestedBy      string          `json:"requestedBy,omitempty"`
	AppliedBy        *string         `json:"appliedBy,omitempty"`
	AppliedAt        *time.Time      `json:"appliedAt,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
}
