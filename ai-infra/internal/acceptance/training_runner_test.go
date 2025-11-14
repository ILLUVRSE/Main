package acceptance

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/ILLUVRSE/Main/ai-infra/internal/runner"
	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/signing"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

func TestTrainingRunnerProducesDeterministicArtifact(t *testing.T) {
	ctx := context.Background()
	memStore := store.NewMemoryStore()
	signer := newTestSigner(t)
	svc := service.New(memStore, sentinel.NewStaticClient(0.1), signer)

	job, err := svc.CreateTrainingJob(ctx, service.TrainingJobRequest{
		CodeRef:         "git://repo@main",
		ContainerDigest: "sha256:def",
		Hyperparams:     json.RawMessage(`{"lr":0.01,"layers":[64,128],"dropout":0.1}`),
		DatasetRefs:     json.RawMessage(`["s3://datasets/train","s3://datasets/val"]`),
		Seed:            time.Now().UnixNano(),
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	expectedChecksum, err := runner.ComputeArtifactChecksum(job)
	if err != nil {
		t.Fatalf("compute checksum: %v", err)
	}

	processed, err := runner.ProcessNextJob(ctx, svc, memStore)
	if err != nil {
		t.Fatalf("process job: %v", err)
	}
	if !processed {
		t.Fatalf("expected job to be processed")
	}

	arts, err := memStore.ListArtifacts(ctx, store.ListArtifactsFilter{
		TrainingJobID: &job.ID,
		Limit:         5,
	})
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	if len(arts) != 1 {
		t.Fatalf("expected 1 artifact, got %d", len(arts))
	}
	if arts[0].Checksum != expectedChecksum {
		t.Fatalf("checksum mismatch: want %s got %s", expectedChecksum, arts[0].Checksum)
	}

	finalJob, err := memStore.GetTrainingJob(ctx, job.ID)
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	if finalJob.Status != "completed" {
		t.Fatalf("expected completed status, got %s", finalJob.Status)
	}
}

func newTestSigner(t *testing.T) signing.Signer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := signing.NewEd25519SignerFromB64(base64.StdEncoding.EncodeToString(priv), "runner-signer")
	if err != nil {
		t.Fatalf("signer init: %v", err)
	}
	return signer
}
