package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ILLUVRSE/Main/eval-engine/internal/model"
	"github.com/google/uuid"
)

type PromotionService struct {
	db              *sql.DB
	financeURL      string
	reasoningURL    string
}

func NewPromotionService(db *sql.DB, financeURL, reasoningURL string) *PromotionService {
	return &PromotionService{
		db:           db,
		financeURL:   financeURL,
		reasoningURL: reasoningURL,
	}
}

type PromotionRequest struct {
	RequestID      string                 `json:"requestId"`
	ArtifactID     string                 `json:"artifactId"`
	Reason         string                 `json:"reason"`
	Score          float64                `json:"score"`
	Confidence     float64                `json:"confidence"`
	Evidence       map[string]interface{} `json:"evidence"`
	Target         map[string]interface{} `json:"target"`
	AuditContext   map[string]interface{} `json:"audit_context"`
	IdempotencyKey string                 `json:"idempotency_key"`
}

type AllocationRequest struct {
	ID             string                 `json:"id"`
	EntityID       string                 `json:"entity_id"`
	Resources      map[string]interface{} `json:"resources"` // cpu, gpu, etc.
	IdempotencyKey string                 `json:"idempotency_key"`
	AuditContext   map[string]interface{} `json:"audit_context"`
}

func (s *PromotionService) Promote(ctx context.Context, req PromotionRequest) (*model.Promotion, error) {
	// 1. Idempotency Check
	if s.db != nil && req.IdempotencyKey != "" {
		var existingID string
		var status model.PromotionStatus
		err := s.db.QueryRowContext(ctx, "SELECT id, status FROM promotions WHERE idempotency_key = $1", req.IdempotencyKey).Scan(&existingID, &status)
		if err == nil {
			// Found existing
			return &model.Promotion{
				ID:     existingID,
				Status: status,
			}, nil
		} else if err != sql.ErrNoRows {
			return nil, fmt.Errorf("idempotency check failed: %w", err)
		}
	}

	// 2. Create Promotion record (pending)
	promoID := uuid.New().String()
	promotion := &model.Promotion{
		ID:             promoID,
		ArtifactID:     req.ArtifactID,
		Reason:         req.Reason,
		Score:          req.Score,
		Status:         model.PromotionStatusPending,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		AuditContext:   req.AuditContext,
	}

	if s.db != nil {
		auditJSON, _ := json.Marshal(req.AuditContext)
		metadataJSON, _ := json.Marshal(map[string]interface{}{"requestId": req.RequestID})

		_, err := s.db.ExecContext(ctx, `
			INSERT INTO promotions (id, artifact_id, reason, score, status, created_at, updated_at, audit_context, metadata, idempotency_key)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			promotion.ID, promotion.ArtifactID, promotion.Reason, promotion.Score, promotion.Status,
			promotion.CreatedAt, promotion.UpdatedAt, auditJSON, metadataJSON, req.IdempotencyKey)
		if err != nil {
			return nil, fmt.Errorf("failed to persist promotion: %w", err)
		}
	}

	// 3. Call Reasoning Graph to record decision
	if s.reasoningURL != "" {
		eventID, err := s.recordReasoningEvent(ctx, promotion)
		if err != nil {
			fmt.Printf("Warning: failed to record reasoning event: %v\n", err)
		} else {
			promotion.EventID = eventID
			if s.db != nil {
				s.db.ExecContext(ctx, "UPDATE promotions SET event_id = $1 WHERE id = $2", eventID, promoID)
			}
		}
	}

	// 4. Trigger Allocation
	allocReq := AllocationRequest{
		ID:             uuid.New().String(),
		EntityID:       promotion.ArtifactID,
		Resources:      map[string]interface{}{"cpu": 1, "memory": "2GB"},
		IdempotencyKey: "alloc-" + req.RequestID,
		AuditContext:   req.AuditContext,
	}

	if _, err := s.Allocate(ctx, allocReq); err != nil {
		if s.db != nil {
			s.db.ExecContext(ctx, "UPDATE promotions SET status = $1 WHERE id = $2", model.PromotionStatusFailed, promoID)
		}
		// Emit failure audit event
		s.emitAuditEvent(ctx, "promotion.failed", map[string]interface{}{
			"promotion_id": promoID,
			"error":        err.Error(),
		})
		return nil, fmt.Errorf("allocation failed: %w", err)
	}

	// 5. Mark as accepted
	promotion.Status = model.PromotionStatusAccepted
	if s.db != nil {
		s.db.ExecContext(ctx, "UPDATE promotions SET status = $1, updated_at = $2 WHERE id = $3",
			model.PromotionStatusAccepted, time.Now(), promoID)
	}

	// 6. Emit Audit Event
	if err := s.emitAuditEvent(ctx, "promotion.created", promotion); err != nil {
		fmt.Printf("Warning: failed to emit audit event: %v\n", err)
	}

	return promotion, nil
}

func (s *PromotionService) Allocate(ctx context.Context, req AllocationRequest) (*model.Allocation, error) {
	if req.EntityID == "" {
		return nil, fmt.Errorf("entity_id is required")
	}

	if s.financeURL != "" {
		if err := s.callFinanceAllocation(ctx, req); err != nil {
			return nil, fmt.Errorf("finance allocation failed: %w", err)
		}
	}

	alloc := &model.Allocation{
		ID:        req.ID,
		EntityID:  req.EntityID,
		Status:    "reserved",
		Resources: req.Resources,
		CreatedAt: time.Now(),
	}

	s.emitAuditEvent(ctx, "allocation.requested", alloc)

	return alloc, nil
}

// Helpers

func (s *PromotionService) emitAuditEvent(ctx context.Context, eventType string, payload interface{}) error {
	if s.db == nil {
		return nil
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	id := uuid.New().String()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO audit_events (id, event_type, actor, payload, created_at)
		VALUES ($1, $2, $3, $4, $5)`,
		id, eventType, "service:eval-engine", payloadJSON, time.Now())

	return err
}

func (s *PromotionService) recordReasoningEvent(ctx context.Context, p *model.Promotion) (string, error) {
	body := map[string]interface{}{
		"nodes": []map[string]interface{}{
			{
				"id":      uuid.New().String(),
				"type":    "Decision",
				"actor":   "service:eval-engine",
				"ts":      time.Now().Format(time.RFC3339),
				"payload": map[string]interface{}{"reason": p.Reason, "score": p.Score},
				"metadata": map[string]interface{}{
					"promotion_id": p.ID,
					"artifact_id":  p.ArtifactID,
				},
			},
		},
	}

	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", s.reasoningURL+"/nodes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("reasoning graph returned %d", resp.StatusCode)
	}

	return "event-id-stub", nil
}

func (s *PromotionService) callFinanceAllocation(ctx context.Context, req AllocationRequest) error {
	jsonBody, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(ctx, "POST", s.financeURL+"/finance/ledger/allocate", bytes.NewBuffer(jsonBody))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Idempotency-Key", req.IdempotencyKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("finance service returned %d", resp.StatusCode)
	}
	return nil
}
