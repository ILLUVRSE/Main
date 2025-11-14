package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

func TestComputeTraceAncestors(t *testing.T) {
	mem := newMemoryStore()
	a := fakeNode("observation")
	b := fakeNode("recommendation")
	c := fakeNode("decision")

	mem.nodes[a.ID] = a
	mem.nodes[b.ID] = b
	mem.nodes[c.ID] = c

	mem.link(a.ID, b.ID)
	mem.link(b.ID, c.ID)

	svc := New(mem, noopSigner{}, Config{MaxTraceDepth: 5, SnapshotDepth: 2, MaxSnapshotRoots: 4})

	trace, err := svc.ComputeTrace(context.Background(), c.ID, models.TraceDirectionAncestors, 3)
	if err != nil {
		t.Fatalf("ComputeTrace returned error: %v", err)
	}
	if len(trace.Steps) != 3 {
		t.Fatalf("expected 3 steps, got %d", len(trace.Steps))
	}
	if trace.Steps[0].Node.ID != c.ID || trace.Steps[0].Depth != 0 {
		t.Fatalf("unexpected first step: %#v", trace.Steps[0])
	}
	if trace.Steps[1].Node.ID != b.ID {
		t.Fatalf("expected second step to be node b")
	}
	if trace.Steps[2].Node.ID != a.ID {
		t.Fatalf("expected third step to be node a")
	}
	if len(trace.Edges) != 2 {
		t.Fatalf("expected 2 edges, got %d", len(trace.Edges))
	}
}

func TestCreateSnapshotHashesAndSigns(t *testing.T) {
	mem := newMemoryStore()
	root := fakeNode("decision")
	child := fakeNode("action")
	mem.nodes[root.ID] = root
	mem.nodes[child.ID] = child
	mem.link(root.ID, child.ID)

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(priv)
	signer, err := signing.NewEd25519SignerFromB64(b64, "test-signer")
	if err != nil {
		t.Fatalf("signer init: %v", err)
	}
	svc := New(mem, signer, Config{SnapshotDepth: 2, MaxSnapshotRoots: 4})

	snap, err := svc.CreateSnapshot(context.Background(), SnapshotRequest{
		RootNodeIDs: []uuid.UUID{root.ID},
		Description: strPtr("test snapshot"),
	})
	if err != nil {
		t.Fatalf("CreateSnapshot returned error: %v", err)
	}
	if snap.Hash == "" || snap.Signature == "" {
		t.Fatalf("expected hash and signature")
	}

	var payload struct {
		Nodes []models.ReasonNode `json:"nodes"`
		Edges []models.ReasonEdge `json:"edges"`
	}
	if err := json.Unmarshal(snap.Snapshot, &payload); err != nil {
		t.Fatalf("unmarshal snapshot payload: %v", err)
	}
	if len(payload.Nodes) != 2 {
		t.Fatalf("expected 2 nodes in snapshot, got %d", len(payload.Nodes))
	}
	if len(payload.Edges) != 1 {
		t.Fatalf("expected 1 edge in snapshot, got %d", len(payload.Edges))
	}

	hash := sha256.Sum256(snap.Snapshot)
	if snap.Hash != fmt.Sprintf("%x", hash[:]) {
		t.Fatalf("hash mismatch")
	}
	sigBytes, err := base64.StdEncoding.DecodeString(snap.Signature)
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if !ed25519.Verify(pub, hash[:], sigBytes) {
		t.Fatalf("signature verification failed")
	}
}

// --- test helpers ---

type memoryStore struct {
	nodes     map[uuid.UUID]models.ReasonNode
	incoming  map[uuid.UUID][]models.ReasonEdge
	outgoing  map[uuid.UUID][]models.ReasonEdge
	snapshots []models.ReasonSnapshot
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		nodes:    map[uuid.UUID]models.ReasonNode{},
		incoming: map[uuid.UUID][]models.ReasonEdge{},
		outgoing: map[uuid.UUID][]models.ReasonEdge{},
	}
}

func (m *memoryStore) CreateNode(ctx context.Context, in store.NodeInput) (models.ReasonNode, error) {
	return models.ReasonNode{}, nil
}

func (m *memoryStore) GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error) {
	node, ok := m.nodes[id]
	if !ok {
		return models.ReasonNode{}, store.ErrNotFound
	}
	return node, nil
}

func (m *memoryStore) CreateEdge(ctx context.Context, in store.EdgeInput) (models.ReasonEdge, error) {
	return models.ReasonEdge{}, nil
}

func (m *memoryStore) ListEdgesFrom(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	return append([]models.ReasonEdge(nil), m.outgoing[nodeID]...), nil
}

func (m *memoryStore) ListEdgesTo(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	return append([]models.ReasonEdge(nil), m.incoming[nodeID]...), nil
}

func (m *memoryStore) CreateSnapshot(ctx context.Context, in store.SnapshotInput) (models.ReasonSnapshot, error) {
	snap := models.ReasonSnapshot{
		ID:          uuid.New(),
		RootNodeIDs: in.RootNodeIDs,
		Description: in.Description,
		Hash:        in.Hash,
		Signature:   in.Signature,
		SignerID:    in.SignerID,
		Snapshot:    in.Snapshot,
		CreatedAt:   time.Now().UTC(),
	}
	m.snapshots = append(m.snapshots, snap)
	return snap, nil
}

func (m *memoryStore) GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error) {
	return models.ReasonSnapshot{}, store.ErrNotFound
}

func (m *memoryStore) Ping(ctx context.Context) error { return nil }

func (m *memoryStore) link(from, to uuid.UUID) {
	edge := models.ReasonEdge{
		ID:        uuid.New(),
		From:      from,
		To:        to,
		Type:      "causal",
		CreatedAt: time.Now().UTC(),
		Metadata:  json.RawMessage(`{}`),
	}
	m.outgoing[from] = append(m.outgoing[from], edge)
	m.incoming[to] = append(m.incoming[to], edge)
}

type noopSigner struct{}

func (noopSigner) Sign(ctx context.Context, payload []byte) ([]byte, error) {
	return payload, nil
}

func (noopSigner) SignerID() string {
	return "noop"
}

func fakeNode(nodeType string) models.ReasonNode {
	return models.ReasonNode{
		ID:        uuid.New(),
		Type:      nodeType,
		Payload:   json.RawMessage(`{}`),
		Author:    "tester",
		Metadata:  json.RawMessage(`{}`),
		CreatedAt: time.Now().UTC(),
	}
}

func strPtr(s string) *string {
	return &s
}
