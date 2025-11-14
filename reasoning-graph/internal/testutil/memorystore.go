package testutil

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

// MemoryStore is a lightweight in-memory implementation of store.Store used by tests.
type MemoryStore struct {
	Nodes     map[uuid.UUID]models.ReasonNode
	Edges     map[uuid.UUID]models.ReasonEdge
	Snapshots map[uuid.UUID]models.ReasonSnapshot

	// NowFunc allows tests to control timestamps.
	NowFunc func() time.Time
}

// NewMemoryStore returns a MemoryStore with empty state.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		Nodes:     make(map[uuid.UUID]models.ReasonNode),
		Edges:     make(map[uuid.UUID]models.ReasonEdge),
		Snapshots: make(map[uuid.UUID]models.ReasonSnapshot),
		NowFunc: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func ensureJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}

func (m *MemoryStore) now() time.Time {
	if m.NowFunc != nil {
		return m.NowFunc()
	}
	return time.Now().UTC()
}

// --- store.Store implementation ---

func (m *MemoryStore) CreateNode(ctx context.Context, in store.NodeInput) (models.ReasonNode, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	node := models.ReasonNode{
		ID:                  in.ID,
		Type:                in.Type,
		Payload:             ensureJSON(in.Payload),
		Author:              in.Author,
		Version:             in.Version,
		ManifestSignatureID: in.ManifestSignatureID,
		AuditEventID:        in.AuditEventID,
		Metadata:            ensureJSON(in.Metadata),
		CreatedAt:           m.now(),
	}
	m.Nodes[node.ID] = node
	return node, nil
}

func (m *MemoryStore) GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error) {
	node, ok := m.Nodes[id]
	if !ok {
		return models.ReasonNode{}, store.ErrNotFound
	}
	return node, nil
}

func (m *MemoryStore) CreateEdge(ctx context.Context, in store.EdgeInput) (models.ReasonEdge, error) {
	if _, ok := m.Nodes[in.From]; !ok {
		return models.ReasonEdge{}, fmt.Errorf("create edge from: %w", store.ErrNotFound)
	}
	if _, ok := m.Nodes[in.To]; !ok {
		return models.ReasonEdge{}, fmt.Errorf("create edge to: %w", store.ErrNotFound)
	}
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	edge := models.ReasonEdge{
		ID:        in.ID,
		From:      in.From,
		To:        in.To,
		Type:      in.Type,
		Weight:    in.Weight,
		Metadata:  ensureJSON(in.Metadata),
		CreatedAt: m.now(),
	}
	m.Edges[edge.ID] = edge
	return edge, nil
}

func (m *MemoryStore) ListEdgesFrom(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	var edges []models.ReasonEdge
	for _, edge := range m.Edges {
		if edge.From == nodeID {
			edges = append(edges, edge)
		}
	}
	sortEdges(edges)
	return edges, nil
}

func (m *MemoryStore) ListEdgesTo(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	var edges []models.ReasonEdge
	for _, edge := range m.Edges {
		if edge.To == nodeID {
			edges = append(edges, edge)
		}
	}
	sortEdges(edges)
	return edges, nil
}

func (m *MemoryStore) CreateSnapshot(ctx context.Context, in store.SnapshotInput) (models.ReasonSnapshot, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	snapshot := models.ReasonSnapshot{
		ID:          in.ID,
		RootNodeIDs: append([]uuid.UUID(nil), in.RootNodeIDs...),
		Description: in.Description,
		Hash:        in.Hash,
		Signature:   in.Signature,
		SignerID:    in.SignerID,
		Snapshot:    ensureJSON(in.Snapshot),
		CreatedAt:   m.now(),
	}
	m.Snapshots[snapshot.ID] = snapshot
	return snapshot, nil
}

func (m *MemoryStore) GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error) {
	snapshot, ok := m.Snapshots[id]
	if !ok {
		return models.ReasonSnapshot{}, store.ErrNotFound
	}
	return snapshot, nil
}

func (m *MemoryStore) Ping(ctx context.Context) error {
	return nil
}

// --- helpers for tests ---

// AddNode inserts a pre-built node into the store.
func (m *MemoryStore) AddNode(node models.ReasonNode) {
	if node.ID == uuid.Nil {
		node.ID = uuid.New()
	}
	if node.CreatedAt.IsZero() {
		node.CreatedAt = m.now()
	}
	if len(node.Payload) == 0 {
		node.Payload = json.RawMessage(`{}`)
	}
	if len(node.Metadata) == 0 {
		node.Metadata = json.RawMessage(`{}`)
	}
	m.Nodes[node.ID] = node
}

// AddEdge inserts a pre-built edge into the store.
func (m *MemoryStore) AddEdge(edge models.ReasonEdge) {
	if edge.ID == uuid.Nil {
		edge.ID = uuid.New()
	}
	if edge.CreatedAt.IsZero() {
		edge.CreatedAt = m.now()
	}
	if len(edge.Metadata) == 0 {
		edge.Metadata = json.RawMessage(`{}`)
	}
	m.Edges[edge.ID] = edge
}

// Link convenience helper to create an edge between nodes using defaults.
func (m *MemoryStore) Link(from, to uuid.UUID, edgeType string) models.ReasonEdge {
	edge := models.ReasonEdge{
		ID:        uuid.New(),
		From:      from,
		To:        to,
		Type:      edgeType,
		CreatedAt: m.now(),
		Metadata:  json.RawMessage(`{}`),
	}
	m.AddEdge(edge)
	return edge
}

func sortEdges(edges []models.ReasonEdge) {
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].CreatedAt.Equal(edges[j].CreatedAt) {
			return edges[i].ID.String() < edges[j].ID.String()
		}
		return edges[i].CreatedAt.Before(edges[j].CreatedAt)
	})
}
