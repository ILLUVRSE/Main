package sentinel_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/signing"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

func TestHTTPClientAffectsPromotionFlow(t *testing.T) {
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/sentinelnet/check" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		defer r.Body.Close()
		var payload struct {
			Evaluation map[string]float64 `json:"evaluation"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		allowed := payload.Evaluation["quality"] >= 0.9
		resp := sentinel.Decision{
			Allowed:  allowed,
			PolicyID: "test-policy",
			Reason:   "mock response",
		}
		respBody, _ := json.Marshal(resp)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewReader(respBody)),
			Header:     make(http.Header),
		}, nil
	})

	client, err := sentinel.NewHTTPClient(sentinel.HTTPClientConfig{
		BaseURL:    "http://sentinel",
		Timeout:    time.Second,
		Retries:    1,
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		t.Fatalf("new sentinel client: %v", err)
	}

	memStore := store.NewMemoryStore()
	signer := testSigner(t)
	svc := service.New(memStore, client, signer)

	ctx := context.Background()
	job, err := svc.CreateTrainingJob(ctx, service.TrainingJobRequest{
		CodeRef:         "git://repo@abcd",
		ContainerDigest: "sha256:test",
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	artifact, err := svc.RegisterArtifact(ctx, service.RegisterArtifactRequest{
		TrainingJobID: job.ID,
		ArtifactURI:   "s3://bucket/artifact-1",
		Checksum:      "checksum-1",
	})
	if err != nil {
		t.Fatalf("register artifact: %v", err)
	}

	applied, err := svc.PromoteArtifact(ctx, service.PromotionRequest{
		ArtifactID:  artifact.ID,
		Environment: "staging",
		Evaluation:  json.RawMessage(`{"quality":0.95}`),
	})
	if err != nil {
		t.Fatalf("promote (allow): %v", err)
	}
	if applied.Status != "applied" {
		t.Fatalf("expected applied status, got %s", applied.Status)
	}

	rejected, err := svc.PromoteArtifact(ctx, service.PromotionRequest{
		ArtifactID:  artifact.ID,
		Environment: "production",
		Evaluation:  json.RawMessage(`{"quality":0.5}`),
	})
	if err != nil {
		t.Fatalf("promote (reject): %v", err)
	}
	if rejected.Status != "rejected" {
		t.Fatalf("expected rejected status, got %s", rejected.Status)
	}
	if len(rejected.SentinelDecision) == 0 {
		t.Fatalf("missing sentinel decision details")
	}
}

func testSigner(t *testing.T) signing.Signer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := signing.NewEd25519SignerFromB64(base64.StdEncoding.EncodeToString(priv), uuid.NewString())
	if err != nil {
		t.Fatalf("signer init: %v", err)
	}
	return signer
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
