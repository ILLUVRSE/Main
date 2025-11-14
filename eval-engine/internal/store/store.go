package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/models"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	InsertEvalReport(ctx context.Context, in EvalReportInput) (models.EvalReport, error)
	UpsertAgentScore(ctx context.Context, in AgentScoreInput) (models.AgentScore, error)
	GetAgentScore(ctx context.Context, agentID string) (models.AgentScore, error)
	CreatePromotionEvent(ctx context.Context, in PromotionInput) (models.PromotionEvent, error)
	LinkPromotionAllocation(ctx context.Context, promotionID, allocationID uuid.UUID) error
	CreateAllocationRequest(ctx context.Context, in AllocationInput) (models.AllocationRequest, error)
	UpdateAllocationStatus(ctx context.Context, in AllocationStatusUpdate) (models.AllocationRequest, error)
	GetAllocationRequest(ctx context.Context, id uuid.UUID) (models.AllocationRequest, error)
	Ping(ctx context.Context) error
}

type PGStore struct {
	db *sql.DB
}

func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

type EvalReportInput struct {
	ID        uuid.UUID
	AgentID   string
	MetricSet json.RawMessage
	Source    string
	Tags      json.RawMessage
	TS        time.Time
}

type AgentScoreInput struct {
	AgentID    string
	Score      float64
	Components json.RawMessage
	Confidence float64
	Window     string
	ComputedAt time.Time
}

type PromotionInput struct {
	ID          uuid.UUID
	AgentID     string
	Action      string
	Rationale   string
	Confidence  float64
	Status      string
	RequestedBy string
}

type AllocationInput struct {
	ID          uuid.UUID
	PromotionID *uuid.UUID
	AgentID     string
	Pool        string
	Delta       int
	Reason      string
	Status      string
	RequestedBy string
}

type AllocationStatusUpdate struct {
	ID               uuid.UUID
	Status           string
	SentinelDecision json.RawMessage
	AppliedBy        *string
	AppliedAt        *time.Time
}

func ensureJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}

func (s *PGStore) InsertEvalReport(ctx context.Context, in EvalReportInput) (models.EvalReport, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO eval_reports (id, agent_id, metric_set, source, tags, ts)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING created_at
	`
	var createdAt time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.AgentID, ensureJSON(in.MetricSet), in.Source, ensureJSON(in.Tags), in.TS).Scan(&createdAt); err != nil {
		return models.EvalReport{}, fmt.Errorf("insert eval report: %w", err)
	}
	return models.EvalReport{
		ID:        in.ID,
		AgentID:   in.AgentID,
		MetricSet: ensureJSON(in.MetricSet),
		Source:    in.Source,
		Tags:      ensureJSON(in.Tags),
		TS:        in.TS,
		CreatedAt: createdAt,
	}, nil
}

func (s *PGStore) UpsertAgentScore(ctx context.Context, in AgentScoreInput) (models.AgentScore, error) {
	query := `
		INSERT INTO agent_scores (agent_id, score, components, confidence, window, computed_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (agent_id)
		DO UPDATE SET score = EXCLUDED.score,
			components = EXCLUDED.components,
			confidence = EXCLUDED.confidence,
			window = EXCLUDED.window,
			computed_at = EXCLUDED.computed_at
		RETURNING computed_at
	`
	var computedAt time.Time
	if err := s.db.QueryRowContext(ctx, query, in.AgentID, in.Score, ensureJSON(in.Components), in.Confidence, in.Window, in.ComputedAt).Scan(&computedAt); err != nil {
		return models.AgentScore{}, fmt.Errorf("upsert agent score: %w", err)
	}
	return models.AgentScore{
		AgentID:    in.AgentID,
		Score:      in.Score,
		Components: ensureJSON(in.Components),
		Confidence: in.Confidence,
		Window:     in.Window,
		ComputedAt: computedAt,
	}, nil
}

func (s *PGStore) GetAgentScore(ctx context.Context, agentID string) (models.AgentScore, error) {
	const query = `
		SELECT agent_id, score, components, confidence, window, computed_at
		FROM agent_scores
		WHERE agent_id=$1
	`
	var score models.AgentScore
	var components []byte
	if err := s.db.QueryRowContext(ctx, query, agentID).Scan(&score.AgentID, &score.Score, &components, &score.Confidence, &score.Window, &score.ComputedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.AgentScore{}, ErrNotFound
		}
		return models.AgentScore{}, fmt.Errorf("get agent score: %w", err)
	}
	score.Components = append(json.RawMessage(nil), components...)
	return score, nil
}

func (s *PGStore) CreatePromotionEvent(ctx context.Context, in PromotionInput) (models.PromotionEvent, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO promotion_events (id, agent_id, action, rationale, confidence, status, requested_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at
	`
	var created time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.AgentID, in.Action, in.Rationale, in.Confidence, in.Status, in.RequestedBy).Scan(&created); err != nil {
		return models.PromotionEvent{}, fmt.Errorf("insert promotion event: %w", err)
	}
	return models.PromotionEvent{
		ID:          in.ID,
		AgentID:     in.AgentID,
		Action:      in.Action,
		Rationale:   in.Rationale,
		Confidence:  in.Confidence,
		Status:      in.Status,
		RequestedBy: in.RequestedBy,
		CreatedAt:   created,
	}, nil
}

func (s *PGStore) LinkPromotionAllocation(ctx context.Context, promotionID, allocationID uuid.UUID) error {
	query := `UPDATE promotion_events SET allocation_request_id=$1 WHERE id=$2`
	res, err := s.db.ExecContext(ctx, query, allocationID, promotionID)
	if err != nil {
		return fmt.Errorf("link promotion allocation: %w", err)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PGStore) CreateAllocationRequest(ctx context.Context, in AllocationInput) (models.AllocationRequest, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO allocation_requests (id, promotion_id, agent_id, pool, delta, reason, status, requested_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at, updated_at
	`
	var created, updated time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.PromotionID, in.AgentID, in.Pool, in.Delta, in.Reason, in.Status, in.RequestedBy).Scan(&created, &updated); err != nil {
		return models.AllocationRequest{}, fmt.Errorf("insert allocation request: %w", err)
	}
	return models.AllocationRequest{
		ID:          in.ID,
		PromotionID: in.PromotionID,
		AgentID:     in.AgentID,
		Pool:        in.Pool,
		Delta:       in.Delta,
		Reason:      in.Reason,
		Status:      in.Status,
		RequestedBy: in.RequestedBy,
		CreatedAt:   created,
		UpdatedAt:   updated,
	}, nil
}

func (s *PGStore) UpdateAllocationStatus(ctx context.Context, in AllocationStatusUpdate) (models.AllocationRequest, error) {
	query := `
		UPDATE allocation_requests
		SET status=$2,
		    sentinel_decision=$3,
		    applied_by=$4,
		    applied_at=$5,
		    updated_at=NOW()
		WHERE id=$1
		RETURNING promotion_id, agent_id, pool, delta, reason, requested_by, status,
		          sentinel_decision, applied_by, applied_at, created_at, updated_at
	`
	var record models.AllocationRequest
	var (
		promotionID sql.NullString
		sentinel    []byte
		appliedBy   sql.NullString
		appliedAt   sql.NullTime
	)
	err := s.db.QueryRowContext(ctx, query, in.ID, in.Status, in.SentinelDecision, in.AppliedBy, in.AppliedAt).Scan(
		&promotionID,
		&record.AgentID,
		&record.Pool,
		&record.Delta,
		&record.Reason,
		&record.RequestedBy,
		&record.Status,
		&sentinel,
		&appliedBy,
		&appliedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.AllocationRequest{}, ErrNotFound
		}
		return models.AllocationRequest{}, fmt.Errorf("update allocation status: %w", err)
	}
	record.ID = in.ID
	if promotionID.Valid {
		id, err := uuid.Parse(promotionID.String)
		if err == nil {
			record.PromotionID = &id
		}
	}
	if len(sentinel) > 0 {
		record.SentinelDecision = append(json.RawMessage(nil), sentinel...)
	}
	if appliedBy.Valid {
		record.AppliedBy = &appliedBy.String
	}
	if appliedAt.Valid {
		t := appliedAt.Time
		record.AppliedAt = &t
	}
	return record, nil
}

func (s *PGStore) GetAllocationRequest(ctx context.Context, id uuid.UUID) (models.AllocationRequest, error) {
	const query = `
		SELECT promotion_id, agent_id, pool, delta, reason, requested_by, status, sentinel_decision,
		       applied_by, applied_at, created_at, updated_at
		FROM allocation_requests
		WHERE id=$1
	`
	var (
		record    models.AllocationRequest
		promo     sql.NullString
		sentinel  []byte
		appliedBy sql.NullString
		appliedAt sql.NullTime
	)
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&promo,
		&record.AgentID,
		&record.Pool,
		&record.Delta,
		&record.Reason,
		&record.RequestedBy,
		&record.Status,
		&sentinel,
		&appliedBy,
		&appliedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.AllocationRequest{}, ErrNotFound
		}
		return models.AllocationRequest{}, fmt.Errorf("get allocation: %w", err)
	}
	record.ID = id
	if promo.Valid {
		pID, err := uuid.Parse(promo.String)
		if err == nil {
			record.PromotionID = &pID
		}
	}
	if len(sentinel) > 0 {
		record.SentinelDecision = append(json.RawMessage(nil), sentinel...)
	}
	if appliedBy.Valid {
		record.AppliedBy = &appliedBy.String
	}
	if appliedAt.Valid {
		t := appliedAt.Time
		record.AppliedAt = &t
	}
	return record, nil
}

func (s *PGStore) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	return nil
}
