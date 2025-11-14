package acceptance

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/signing"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

func TestTrainRegisterPromoteFlow(t *testing.T) {
	ctx := context.Background()
	memStore := store.NewMemoryStore()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := signing.NewEd25519SignerFromB64(base64.StdEncoding.EncodeToString(priv), "test-signer")
	if err != nil {
		t.Fatalf("signer init: %v", err)
	}

	svc := service.New(memStore, sentinel.NewStaticClient(0.8), signer)

	job, err := svc.CreateTrainingJob(ctx, service.TrainingJobRequest{
		CodeRef:         "git://repo@sha",
		ContainerDigest: "sha256:abc",
		Seed:            42,
	})
	if err != nil {
		t.Fatalf("create training job: %v", err)
	}
	if job.ID == uuid.Nil {
		t.Fatalf("job id missing")
	}

	artifact, err := svc.RegisterArtifact(ctx, service.RegisterArtifactRequest{
		TrainingJobID: job.ID,
		ArtifactURI:   "s3://bucket/artifact.pt",
		Checksum:      "abc123",
		Metadata:      json.RawMessage(`{"framework":"torch","version":"2.2"}`),
	})
	if err != nil {
		t.Fatalf("register artifact: %v", err)
	}
	if artifact.Signature == "" {
		t.Fatalf("artifact signature missing")
	}

	promo, err := svc.PromoteArtifact(ctx, service.PromotionRequest{
		ArtifactID:  artifact.ID,
		Environment: "staging",
		Evaluation:  json.RawMessage(`{"quality":0.9,"safety":0.95}`),
		RequestedBy: "ml-lead",
	})
	if err != nil {
		t.Fatalf("promote artifact: %v", err)
	}
	if promo.Status != "applied" || promo.Signature == nil {
		t.Fatalf("promotion not applied or missing signature")
	}

	denyPromo, err := svc.PromoteArtifact(ctx, service.PromotionRequest{
		ArtifactID:  artifact.ID,
		Environment: "production",
		Evaluation:  json.RawMessage(`{"quality":0.5}`),
		RequestedBy: "ml-lead",
	})
	if err != nil {
		t.Fatalf("promote artifact (deny): %v", err)
	}
	if denyPromo.Status != "rejected" {
		t.Fatalf("expected rejection due to low quality")
	}
	if len(denyPromo.SentinelDecision) == 0 {
		t.Fatalf("expected sentinel decision recorded")
	}
}
