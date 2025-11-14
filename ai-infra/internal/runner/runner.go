package runner

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/models"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

type Config struct {
	PollInterval time.Duration
	Logger       *log.Logger
}

// RunWorker continuously polls for queued training jobs and executes them until ctx is cancelled.
func RunWorker(ctx context.Context, svc *service.Service, st store.Store, cfg Config) {
	interval := cfg.PollInterval
	if interval <= 0 {
		interval = 2 * time.Second
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.New(os.Stdout, "[trainer] ", log.LstdFlags)
	}

	for {
		if ctx.Err() != nil {
			return
		}
		processed, err := ProcessNextJob(ctx, svc, st)
		if err != nil {
			logger.Printf("process training job: %v", err)
		}
		if !processed {
			select {
			case <-ctx.Done():
				return
			case <-time.After(interval):
			}
		}
	}
}

// ProcessNextJob claims, executes, and finalizes a single training job, returning whether work was done.
func ProcessNextJob(ctx context.Context, svc *service.Service, st store.Store) (bool, error) {
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	job, err := st.ClaimNextTrainingJob(ctx)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	checksum, err := ComputeArtifactChecksum(job)
	if err != nil {
		_ = markJob(ctx, st, job.ID, "failed")
		return true, err
	}

	artifactURI := fmt.Sprintf("s3://ai-infra-dev/artifacts/%s.model", job.ID)
	metaPayload := map[string]interface{}{
		"runner":      "local",
		"status":      "completed",
		"completedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	metaBytes, _ := json.Marshal(metaPayload)

	_, err = svc.RegisterArtifact(ctx, service.RegisterArtifactRequest{
		TrainingJobID: job.ID,
		ArtifactURI:   artifactURI,
		Checksum:      checksum,
		Metadata:      json.RawMessage(metaBytes),
	})
	if err != nil {
		_ = markJob(ctx, st, job.ID, "failed")
		return true, err
	}
	if _, err := st.UpdateTrainingJobStatus(ctx, job.ID, "completed"); err != nil {
		return true, err
	}
	return true, nil
}

func markJob(ctx context.Context, st store.Store, id uuid.UUID, status string) error {
	_, err := st.UpdateTrainingJobStatus(ctx, id, status)
	return err
}

// ComputeArtifactChecksum returns the deterministic checksum for a job definition.
func ComputeArtifactChecksum(job models.TrainingJob) (string, error) {
	hyper, err := canonicalJSON(job.Hyperparams, "{}")
	if err != nil {
		return "", err
	}
	datasets, err := canonicalJSON(job.DatasetRefs, "[]")
	if err != nil {
		return "", err
	}
	payload := job.CodeRef + job.ContainerDigest + hyper + datasets + strconv.FormatInt(job.Seed, 10)
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:]), nil
}

func canonicalJSON(raw json.RawMessage, fallback string) (string, error) {
	if len(raw) == 0 {
		raw = json.RawMessage(fallback)
	}
	var v interface{}
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", err
	}
	buf := &bytes.Buffer{}
	if err := encodeCanonical(buf, v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func encodeCanonical(buf *bytes.Buffer, v interface{}) error {
	switch val := v.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			keyBytes, err := json.Marshal(k)
			if err != nil {
				return err
			}
			buf.Write(keyBytes)
			buf.WriteByte(':')
			if err := encodeCanonical(buf, val[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	case []interface{}:
		buf.WriteByte('[')
		for i, elem := range val {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := encodeCanonical(buf, elem); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case nil:
		buf.WriteString("null")
	case json.Number:
		buf.WriteString(val.String())
	case string, float64, bool:
		b, err := json.Marshal(val)
		if err != nil {
			return err
		}
		buf.Write(b)
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return err
		}
		buf.Write(b)
	}
	return nil
}
