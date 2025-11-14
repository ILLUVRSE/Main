package acceptance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/config"
	"github.com/ILLUVRSE/Main/ai-infra/internal/httpserver"
	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

func TestModelRegistryEndpoints(t *testing.T) {
	ctx := context.Background()
	memStore := store.NewMemoryStore()
	svc := service.New(memStore, sentinel.NewStaticClient(0.5), newTestSigner(t))
	server := httpserver.New(config.Config{}, svc, memStore)
	router := server.Router()

	job, err := svc.CreateTrainingJob(ctx, service.TrainingJobRequest{
		CodeRef:         "git://repo@feature",
		ContainerDigest: "sha256:123",
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	artifact, err := svc.RegisterArtifact(ctx, service.RegisterArtifactRequest{
		TrainingJobID: job.ID,
		ArtifactURI:   "s3://bucket/model.pt",
		Checksum:      "deterministic-checksum",
	})
	if err != nil {
		t.Fatalf("register artifact: %v", err)
	}
	if _, err := svc.PromoteArtifact(ctx, service.PromotionRequest{
		ArtifactID:  artifact.ID,
		Environment: "staging",
		Evaluation:  json.RawMessage(`{"quality":0.95}`),
		RequestedBy: "qa",
	}); err != nil {
		t.Fatalf("promote artifact: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/ai-infra/models?limit=5", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", rec.Code)
	}
	var list []map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) == 0 {
		t.Fatalf("expected at least one artifact")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/ai-infra/models/"+artifact.ID.String(), nil)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", rec2.Code)
	}
	var detail struct {
		Artifact   map[string]interface{}   `json:"artifact"`
		Promotions []map[string]interface{} `json:"promotions"`
	}
	if err := json.NewDecoder(rec2.Body).Decode(&detail); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	if detail.Artifact["id"] == "" {
		t.Fatalf("missing artifact in response")
	}
	if len(detail.Promotions) == 0 {
		t.Fatalf("expected promotions history")
	}
	artifactID, err := uuid.Parse(detail.Artifact["id"].(string))
	if err != nil {
		t.Fatalf("invalid artifact id: %v", err)
	}
	if artifactID != artifact.ID {
		t.Fatalf("artifact id mismatch")
	}
}
