package httpserver

import (
	"bytes"
	"crypto/ed25519"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/config"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/service"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/testutil"
)

const debugToken = "test-debug-token"

func TestCreateNodeRequiresAuth(t *testing.T) {
	_, router := newHTTPTestServer(t)
	body := []byte(`{"type":"decision","payload":{"rationale":"ok"},"author":"kernel"}`)

	rec := doRequest(router, "POST", "/reason/node", body, false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestCreateNodeSuccess(t *testing.T) {
	store, router := newHTTPTestServer(t)
	body := []byte(`{"type":"decision","payload":{"action":"allocate"},"author":"kernel"}`)

	rec := doRequest(router, "POST", "/reason/node", body, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	idStr, ok := resp["nodeId"].(string)
	if !ok {
		t.Fatalf("nodeId missing in response: %v", resp)
	}
	if _, err := uuid.Parse(idStr); err != nil {
		t.Fatalf("invalid node id returned: %v", err)
	}
	if len(store.Nodes) != 1 {
		t.Fatalf("expected 1 node stored, got %d", len(store.Nodes))
	}
}

func TestCreateEdgeRequiresNodes(t *testing.T) {
	_, router := newHTTPTestServer(t)
	body := []byte(`{"from":"d60a3fd0-2bd4-4aac-9ec9-fbbac8b8e153","to":"d3c4a917-f0f7-4f0f-9bc5-a93045ef1122","type":"causal"}`)

	rec := doRequest(router, "POST", "/reason/edge", body, true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when nodes missing, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestGetNodeReturnsEdges(t *testing.T) {
	store, router := newHTTPTestServer(t)
	score := seedNode(store, "score")
	recNode := seedNode(store, "recommendation")
	decision := seedNode(store, "decision")
	store.Link(score.ID, recNode.ID, "causal")
	store.Link(recNode.ID, decision.ID, "supports")

	path := fmt.Sprintf("/reason/node/%s", decision.ID)
	rec := doRequest(router, "GET", path, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var resp struct {
		Node     models.ReasonNode   `json:"node"`
		Incoming []models.ReasonEdge `json:"incoming"`
		Outgoing []models.ReasonEdge `json:"outgoing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Incoming) != 1 || len(resp.Outgoing) != 0 {
		t.Fatalf("unexpected edges: %+v", resp)
	}
}

func TestTraceEndpoint(t *testing.T) {
	store, router := newHTTPTestServer(t)
	score := seedNode(store, "score")
	recNode := seedNode(store, "recommendation")
	decision := seedNode(store, "decision")
	store.Link(score.ID, recNode.ID, "causal")
	store.Link(recNode.ID, decision.ID, "causal")

	path := fmt.Sprintf("/reason/trace/%s?direction=ancestors&depth=5", decision.ID)
	rec := doRequest(router, "GET", path, nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var trace models.TraceResult
	if err := json.Unmarshal(rec.Body.Bytes(), &trace); err != nil {
		t.Fatalf("decode trace: %v", err)
	}
	if len(trace.Steps) != 3 {
		t.Fatalf("unexpected steps length: %d", len(trace.Steps))
	}
	if trace.Steps[0].Node.ID != decision.ID {
		t.Fatalf("first step should be root decision, got %s", trace.Steps[0].Node.ID)
	}
}

func TestSnapshotLifecycle(t *testing.T) {
	store, router := newHTTPTestServer(t)
	root := seedNode(store, "decision")
	child := seedNode(store, "action")
	store.Link(root.ID, child.ID, "causal")

	body := []byte(fmt.Sprintf(`{"rootNodeIds":["%s"],"description":"test snapshot"}`, root.ID))
	rec := doRequest(router, "POST", "/reason/snapshot", body, true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}

	var createResp struct {
		SnapshotID string `json:"snapshotId"`
		Hash       string `json:"hash"`
		Signature  string `json:"signature"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create snapshot resp: %v", err)
	}
	if createResp.SnapshotID == "" || createResp.Hash == "" || createResp.Signature == "" {
		t.Fatalf("snapshot response missing fields: %+v", createResp)
	}
	if len(store.Snapshots) != 1 {
		t.Fatalf("expected snapshot persisted, got %d", len(store.Snapshots))
	}

	getPath := fmt.Sprintf("/reason/snapshot/%s?format=human", createResp.SnapshotID)
	getResp := doRequest(router, "GET", getPath, nil, false)
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", getResp.Code, getResp.Body.String())
	}

	var payload struct {
		Human struct {
			NodeCount float64 `json:"nodeCount"`
			EdgeCount float64 `json:"edgeCount"`
		} `json:"human"`
		Snapshot struct {
			ID string `json:"id"`
		} `json:"snapshot"`
	}
	if err := json.Unmarshal(getResp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode snapshot payload: %v", err)
	}
	if payload.Snapshot.ID != createResp.SnapshotID {
		t.Fatalf("snapshot id mismatch: %+v", payload)
	}
	if payload.Human.NodeCount != 2 || payload.Human.EdgeCount != 1 {
		t.Fatalf("unexpected human summary: %+v", payload.Human)
	}
}

func TestHealthEndpoint(t *testing.T) {
	_, router := newHTTPTestServer(t)
	rec := doRequest(router, "GET", "/health", nil, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode health resp: %v", err)
	}
	if ok, _ := resp["ok"].(bool); !ok {
		t.Fatalf("expected ok=true in health response: %+v", resp)
	}
}

// --- helpers ---

func newHTTPTestServer(t *testing.T) (*testutil.MemoryStore, http.Handler) {
	t.Helper()
	mem := testutil.NewMemoryStore()
	mem.NowFunc = func() time.Time {
		return time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	}
	cfg := config.Config{
		AllowDebugToken:     true,
		DebugToken:          debugToken,
		MaxTraceDepth:       5,
		SnapshotDepth:       3,
		MaxSnapshotRoots:    4,
		MaxNodePayloadBytes: 1024,
	}
	signer := newTestSigner(t)
	svc := service.New(mem, signer, service.Config{
		MaxTraceDepth:    cfg.MaxTraceDepth,
		SnapshotDepth:    cfg.SnapshotDepth,
		MaxSnapshotRoots: cfg.MaxSnapshotRoots,
	})
	server := New(cfg, mem, svc)
	return mem, server.Router()
}

func newTestSigner(t *testing.T) signing.Signer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(crand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(priv)
	signer, err := signing.NewEd25519SignerFromB64(b64, "test-signer")
	if err != nil {
		t.Fatalf("init signer: %v", err)
	}
	return signer
}

func seedNode(store *testutil.MemoryStore, nodeType string) models.ReasonNode {
	node := models.ReasonNode{
		ID:       uuid.New(),
		Type:     nodeType,
		Payload:  json.RawMessage(`{"note":"test"}`),
		Author:   "tester",
		Metadata: json.RawMessage(`{}`),
	}
	store.AddNode(node)
	return node
}

func doRequest(router http.Handler, method, path string, body []byte, withAuth bool) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if withAuth {
		req.Header.Set("X-Debug-Token", debugToken)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}
