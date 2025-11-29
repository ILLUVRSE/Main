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
	ID           uuid.UUID       `json:"id"`
	From         uuid.UUID       `json:"from"`
	To           uuid.UUID       `json:"to"`
	Type         string          `json:"type"`
	Weight       *float64        `json:"weight,omitempty"`
	Metadata     json.RawMessage `json:"metadata"`
	AuditEventID *string         `json:"auditEventId,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
}

// ReasonAnnotation represents an append-only annotation on a node or edge.
type ReasonAnnotation struct {
	ID             uuid.UUID       `json:"id"`
	TargetID       uuid.UUID       `json:"targetId"`
	TargetType     string          `json:"targetType"` // "node" or "edge"
	AnnotationType string          `json:"annotationType"`
	Payload        json.RawMessage `json:"payload"`
	AuditEventID   *string         `json:"auditEventId,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// AuditRef represents the minimum audit information required for verification.
type AuditRef struct {
	EventID  string `json:"eventId"`
	PrevHash string `json:"prevHash,omitempty"` // Optional in response if not easily available
}

// OrderedTraceEntry represents a single item (node or edge) in the ordered path.
type OrderedTraceEntry struct {
	ID          uuid.UUID          `json:"id"`
	Type        string             `json:"type"`        // "node" or "edge"
	EntityType  string             `json:"entityType"`  // The actual type (e.g. "decision", "causal")
	Timestamp   time.Time          `json:"timestamp"`
	CausalIndex int                `json:"causalIndex"`
	ParentIDs   []uuid.UUID        `json:"parentIds"`
	Annotations []ReasonAnnotation `json:"annotations"`
	AuditRef    *AuditRef          `json:"auditRef"`
	Payload     json.RawMessage    `json:"payload,omitempty"` // Include payload for reconstruction
	From        *uuid.UUID         `json:"from,omitempty"`    // Only for edges
	To          *uuid.UUID         `json:"to,omitempty"`      // Only for edges
}

// OrderedTraceMetadata contains metadata about the trace generation.
type OrderedTraceMetadata struct {
	TraceID       uuid.UUID `json:"traceId"`
	CreatedAt     time.Time `json:"createdAt"`
	Length        int       `json:"length"`
	CycleDetected bool      `json:"cycleDetected"`
	CycleDetails  string    `json:"cycleDetails,omitempty"`
}

// OrderedTraceResult is the response for GET /traces/{id}.
type OrderedTraceResult struct {
	TraceID     uuid.UUID            `json:"trace_id"`
	OrderedPath []OrderedTraceEntry  `json:"ordered_path"`
	Metadata    OrderedTraceMetadata `json:"metadata"`
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
