package allocator

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/models"
	"github.com/ILLUVRSE/Main/eval-engine/internal/store"
)

type Service struct {
	store    store.Store
	sentinel SentinelClient
	pools    []Pool
}

type Pool struct {
	Name     string `json:"name"`
	Capacity int    `json:"capacity"`
}

func New(store store.Store, sentinel SentinelClient, pools []Pool) *Service {
	return &Service{
		store:    store,
		sentinel: sentinel,
		pools:    pools,
	}
}

type RequestInput struct {
	PromotionID *uuid.UUID
	AgentID     string
	Pool        string
	Delta       int
	Reason      string
	RequestedBy string
}

func (s *Service) RequestAllocation(ctx context.Context, in RequestInput) (models.AllocationRequest, error) {
	if in.AgentID == "" || in.Pool == "" {
		return models.AllocationRequest{}, fmt.Errorf("agentId and pool required")
	}
	if in.Delta == 0 {
		return models.AllocationRequest{}, fmt.Errorf("delta must be non-zero")
	}
	req, err := s.store.CreateAllocationRequest(ctx, store.AllocationInput{
		PromotionID: in.PromotionID,
		AgentID:     in.AgentID,
		Pool:        in.Pool,
		Delta:       in.Delta,
		Reason:      in.Reason,
		Status:      "pending",
		RequestedBy: in.RequestedBy,
	})
	if err != nil {
		return models.AllocationRequest{}, err
	}
	return req, nil
}

type ApproveInput struct {
	RequestID  uuid.UUID
	ApprovedBy string
}

func (s *Service) Approve(ctx context.Context, in ApproveInput) (models.AllocationRequest, error) {
	req, err := s.store.GetAllocationRequest(ctx, in.RequestID)
	if err != nil {
		return models.AllocationRequest{}, err
	}
	decision := SentinelDecision{Allowed: true, PolicyID: "sentinel-allow", Reason: "default-allow"}
	if s.sentinel != nil {
		decision, err = s.sentinel.Check(ctx, SentinelRequest{
			AgentID: req.AgentID,
			Pool:    req.Pool,
			Delta:   req.Delta,
		})
		if err != nil {
			return models.AllocationRequest{}, err
		}
	}
	status := "applied"
	if !decision.Allowed {
		status = "rejected"
	}
	now := time.Now().UTC()
	record, err := s.store.UpdateAllocationStatus(ctx, store.AllocationStatusUpdate{
		ID:               in.RequestID,
		Status:           status,
		SentinelDecision: MarshalDecision(decision),
		AppliedBy:        &in.ApprovedBy,
		AppliedAt:        &now,
	})
	if err != nil {
		return models.AllocationRequest{}, err
	}
	return record, nil
}

func (s *Service) GetRequest(ctx context.Context, id uuid.UUID) (models.AllocationRequest, error) {
	return s.store.GetAllocationRequest(ctx, id)
}

func (s *Service) Pools(ctx context.Context) ([]Pool, error) {
	return s.pools, nil
}
