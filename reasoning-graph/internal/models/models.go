package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// ReasonNode represents a stored node in the reasoning graph.
type ReasonNode struct {
	ID                  uuid.UUID       `json:"id"`
	Type                string          `json:"type"`
	Payload             json.RawMessage `json:"payload"`
	Author              string          `json:"author"`
	Version             *string         `json:"version,omitempty"`
	ManifestSignatureID *string         `json:"manifestSignatureId,omitempty"`
	AuditEventID        *string         `json:"auditEventId,omitempty"`
	Metadata            json.RawMessage `json:"metadata"`
	CreatedAt           time.Time       `json:"createdAt"`
}

// ReasonEdge represents a directed connection between nodes.
type ReasonEdge struct {
	ID        uuid.UUID       `json:"id"`
	From      uuid.UUID       `json:"from"`
	To        uuid.UUID       `json:"to"`
	Type      string          `json:"type"`
	Weight    *float64        `json:"weight,omitempty"`
	Metadata  json.RawMessage `json:"metadata"`
	CreatedAt time.Time       `json:"createdAt"`
}

// ReasonSnapshot stores canonical snapshot data and signing metadata.
type ReasonSnapshot struct {
	ID          uuid.UUID       `json:"id"`
	RootNodeIDs []uuid.UUID     `json:"rootNodeIds"`
	Description *string         `json:"description,omitempty"`
	Hash        string          `json:"hash"`
	Signature   string          `json:"signature"`
	SignerID    string          `json:"signerId"`
	Snapshot    json.RawMessage `json:"snapshot"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type TraceDirection string

const (
	TraceDirectionAncestors   TraceDirection = "ancestors"
	TraceDirectionDescendants TraceDirection = "descendants"
)

// TraceStep describes one hop in a computed trace.
type TraceStep struct {
	Node          ReasonNode   `json:"node"`
	IncomingEdges []ReasonEdge `json:"incoming"`
	OutgoingEdges []ReasonEdge `json:"outgoing"`
	CycleDetected bool         `json:"cycleDetected"`
	Depth         int          `json:"depth"`
}

// TraceResult is returned by the trace computation.
type TraceResult struct {
	StartNodeID uuid.UUID      `json:"startNodeId"`
	Direction   TraceDirection `json:"direction"`
	Depth       int            `json:"depth"`
	Steps       []TraceStep    `json:"steps"`
	Edges       []ReasonEdge   `json:"edges"`
	Visited     []uuid.UUID    `json:"visited"`
	GeneratedAt time.Time      `json:"generatedAt"`
}
