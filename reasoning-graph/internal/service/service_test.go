package service

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	mathrand "math/rand"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/testutil"
)

func TestComputeTraceAncestors(t *testing.T) {
	mem := testutil.NewMemoryStore()
	a := fakeNode("observation")
	b := fakeNode("recommendation")
	c := fakeNode("decision")

	mem.AddNode(a)
	mem.AddNode(b)
	mem.AddNode(c)

	mem.Link(a.ID, b.ID, "causal")
	mem.Link(b.ID, c.ID, "causal")

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

func TestComputeTraceDetectsCycle(t *testing.T) {
	mem := testutil.NewMemoryStore()
	a := fakeNode("score")
	b := fakeNode("recommendation")
	c := fakeNode("decision")

	mem.AddNode(a)
	mem.AddNode(b)
	mem.AddNode(c)

	mem.Link(a.ID, b.ID, "supports")
	mem.Link(b.ID, c.ID, "causal")
	mem.Link(c.ID, a.ID, "influencedBy") // creates cycle

	svc := New(mem, noopSigner{}, Config{MaxTraceDepth: 5, SnapshotDepth: 2, MaxSnapshotRoots: 4})
	trace, err := svc.ComputeTrace(context.Background(), c.ID, models.TraceDirectionAncestors, 5)
	if err != nil {
		t.Fatalf("ComputeTrace returned error: %v", err)
	}

	foundCycle := false
	for _, step := range trace.Steps {
		if step.Node.ID == a.ID && step.CycleDetected {
			foundCycle = true
			break
		}
	}
	if !foundCycle {
		t.Fatalf("expected cycle detection flag for node %s", a.ID)
	}
}

func TestCreateSnapshotHashesAndSigns(t *testing.T) {
	mem := testutil.NewMemoryStore()
	root := fakeNode("decision")
	child := fakeNode("action")
	mem.AddNode(root)
	mem.AddNode(child)
	mem.Link(root.ID, child.ID, "causal")

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

	// Helper structs for decoding.
	// We can reuse map[string]interface{} here as well, but for simple counting struct is fine.
	// But to match the change, we can just use generic map.
	var payload map[string]interface{}
	if err := json.Unmarshal(snap.Snapshot, &payload); err != nil {
		t.Fatalf("unmarshal snapshot payload: %v", err)
	}

	nodes, ok := payload["nodes"].([]interface{})
	if !ok {
		t.Fatalf("nodes missing or invalid type")
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes in snapshot, got %d", len(nodes))
	}

	edges, ok := payload["edges"].([]interface{})
	if !ok {
		t.Fatalf("edges missing or invalid type")
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge in snapshot, got %d", len(edges))
	}

	hash := sha256.Sum256(snap.Snapshot)
	if snap.Hash != fmt.Sprintf("%x", hash[:]) {
		t.Fatalf("hash mismatch")
	}
	sigBytes, err := base64.StdEncoding.DecodeString(snap.Signature)
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	// Updated verification: Verify signature against the canonical snapshot bytes directly, NOT the hash.
	if !ed25519.Verify(pub, snap.Snapshot, sigBytes) {
		t.Fatalf("signature verification failed")
	}
}

func TestCanonicalizeSnapshotDeterministic(t *testing.T) {
	nodes := []models.ReasonNode{
		fakeNodeWithID("observation", uuid.MustParse("11111111-1111-1111-1111-111111111111")),
		fakeNodeWithID("recommendation", uuid.MustParse("22222222-2222-2222-2222-222222222222")),
		fakeNodeWithID("decision", uuid.MustParse("33333333-3333-3333-3333-333333333333")),
	}
	edges := []models.ReasonEdge{
		fakeEdge(nodes[0].ID, nodes[1].ID, uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")),
		fakeEdge(nodes[1].ID, nodes[2].ID, uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")),
	}

	var baseline []byte
	rng := mathrand.New(mathrand.NewSource(42))
	for i := 0; i < 5; i++ {
		rng.Shuffle(len(nodes), func(i, j int) {
			nodes[i], nodes[j] = nodes[j], nodes[i]
		})
		rng.Shuffle(len(edges), func(i, j int) {
			edges[i], edges[j] = edges[j], edges[i]
		})
		nodeMap := make(map[uuid.UUID]models.ReasonNode, len(nodes))
		for _, n := range nodes {
			nodeMap[n.ID] = n
		}
		edgeMap := make(map[uuid.UUID]models.ReasonEdge, len(edges))
		for _, e := range edges {
			edgeMap[e.ID] = e
		}

		data, err := canonicalizeSnapshot(nodeMap, edgeMap)
		if err != nil {
			t.Fatalf("canonicalize snapshot: %v", err)
		}
		if i == 0 {
			baseline = data
			continue
		}
		if !bytes.Equal(baseline, data) {
			t.Fatalf("canonicalization is not deterministic")
		}
	}
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

func fakeNodeWithID(nodeType string, id uuid.UUID) models.ReasonNode {
	return models.ReasonNode{
		ID:        id,
		Type:      nodeType,
		Payload:   json.RawMessage(`{}`),
		Author:    "tester",
		Metadata:  json.RawMessage(`{}`),
		CreatedAt: time.Now().UTC(),
	}
}

func fakeEdge(from, to uuid.UUID, id uuid.UUID) models.ReasonEdge {
	return models.ReasonEdge{
		ID:        id,
		From:      from,
		To:        to,
		Type:      "causal",
		Metadata:  json.RawMessage(`{}`),
		CreatedAt: time.Now().UTC(),
	}
}

func strPtr(s string) *string {
	return &s
}
