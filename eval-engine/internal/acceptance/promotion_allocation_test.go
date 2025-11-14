package acceptance

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/allocator"
	"github.com/ILLUVRSE/Main/eval-engine/internal/ingestion"
	"github.com/ILLUVRSE/Main/eval-engine/internal/store"
)

func TestPromotionAllocationSentinelFlow(t *testing.T) {
	ctx := context.Background()
	mem := store.NewMemoryStore()
	sentinel := allocator.NewStaticSentinel([]string{"blocked-pool"}, 1)
	allocService := allocator.New(mem, sentinel, []allocator.Pool{
		{Name: "gpus-us-east", Capacity: 10},
		{Name: "blocked-pool", Capacity: 2},
	})
	client := &fakeAllocatorClient{svc: allocService}
	ingService := ingestion.New(mem, client, ingestion.ServiceConfig{
		PromotionThreshold: 0.8,
		DefaultPool:        "gpus-us-east",
		DefaultDelta:       1,
	})

	metrics, _ := json.Marshal(map[string]float64{
		"successRate": 0.9,
		"latency":     0.95,
	})
	result, err := ingService.SubmitReport(ctx, ingestion.SubmitReportInput{
		AgentID: "agent-123",
		Metrics: metrics,
		Source:  "test",
		TS:      time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("submit report: %v", err)
	}
	if result.Promotion == nil {
		t.Fatalf("expected promotion to trigger")
	}
	if client.lastRequestID == uuid.Nil {
		t.Fatalf("expected allocation request to be created")
	}

	record, err := allocService.Approve(ctx, allocator.ApproveInput{
		RequestID:  client.lastRequestID,
		ApprovedBy: "allocator-bot",
	})
	if err != nil {
		t.Fatalf("approve allocation: %v", err)
	}
	if record.Status != "applied" {
		t.Fatalf("expected applied status, got %s", record.Status)
	}

	manualEvent, err := ingService.CreateManualPromotion(ctx, ingestion.PromotionInput{
		AgentID:     "agent-123",
		Action:      "promote",
		Rationale:   "manual override",
		Confidence:  0.9,
		RequestedBy: "ops",
		Pool:        "blocked-pool",
		Delta:       2,
	})
	if err != nil {
		t.Fatalf("manual promotion: %v", err)
	}
	if manualEvent.ID == uuid.Nil {
		t.Fatalf("promotion id missing")
	}
	blockedID := client.lastRequestID
	record, err = allocService.Approve(ctx, allocator.ApproveInput{
		RequestID:  blockedID,
		ApprovedBy: "allocator-bot",
	})
	if err != nil {
		t.Fatalf("approve blocked allocation: %v", err)
	}
	if record.Status != "rejected" {
		t.Fatalf("expected rejected status")
	}
	if string(record.SentinelDecision) == "" {
		t.Fatalf("expected sentinel decision stored")
	}
}

type fakeAllocatorClient struct {
	svc           *allocator.Service
	lastRequestID uuid.UUID
}

func (f *fakeAllocatorClient) CreateRequest(ctx context.Context, req ingestion.AllocationRequest) (ingestion.AllocationResponse, error) {
	record, err := f.svc.RequestAllocation(ctx, allocator.RequestInput{
		PromotionID: &req.PromotionID,
		AgentID:     req.AgentID,
		Pool:        req.Pool,
		Delta:       req.Delta,
		Reason:      req.Reason,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		return ingestion.AllocationResponse{}, err
	}
	f.lastRequestID = record.ID
	return ingestion.AllocationResponse{
		RequestID: record.ID,
		Status:    record.Status,
	}, nil
}
