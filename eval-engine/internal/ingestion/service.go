package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/models"
	"github.com/ILLUVRSE/Main/eval-engine/internal/store"
)

type AllocatorClient interface {
	CreateRequest(ctx context.Context, req AllocationRequest) (AllocationResponse, error)
}

type AllocationRequest struct {
	PromotionID uuid.UUID `json:"promotionId"`
	AgentID     string    `json:"agentId"`
	Pool        string    `json:"pool"`
	Delta       int       `json:"delta"`
	Reason      string    `json:"reason"`
	RequestedBy string    `json:"requestedBy"`
}

type AllocationResponse struct {
	RequestID uuid.UUID `json:"requestId"`
	Status    string    `json:"status"`
}

type Service struct {
	store store.Store
	alloc AllocatorClient
	cfg   ServiceConfig
}

type ServiceConfig struct {
	PromotionThreshold float64
	DefaultPool        string
	DefaultDelta       int
}

func New(store store.Store, alloc AllocatorClient, cfg ServiceConfig) *Service {
	return &Service{
		store: store,
		alloc: alloc,
		cfg:   cfg,
	}
}

type SubmitReportInput struct {
	AgentID string
	Metrics json.RawMessage
	Source  string
	Tags    json.RawMessage
	TS      time.Time
}

type SubmitReportResult struct {
	Report    models.EvalReport
	Score     models.AgentScore
	Promotion *models.PromotionEvent
}

func (s *Service) SubmitReport(ctx context.Context, in SubmitReportInput) (SubmitReportResult, error) {
	if in.AgentID == "" {
		return SubmitReportResult{}, fmt.Errorf("agentId required")
	}
	if len(in.Metrics) == 0 {
		return SubmitReportResult{}, fmt.Errorf("metrics required")
	}
	if in.TS.IsZero() {
		in.TS = time.Now().UTC()
	}

	report, err := s.store.InsertEvalReport(ctx, store.EvalReportInput{
		AgentID:   in.AgentID,
		MetricSet: in.Metrics,
		Source:    in.Source,
		Tags:      in.Tags,
		TS:        in.TS,
	})
	if err != nil {
		return SubmitReportResult{}, err
	}

	scoreValue, components := computeScore(in.Metrics)
	confidence := computeConfidence(components)
	score, err := s.store.UpsertAgentScore(ctx, store.AgentScoreInput{
		AgentID:    in.AgentID,
		Score:      scoreValue,
		Components: components,
		Confidence: confidence,
		Window:     "1h",
		ComputedAt: time.Now().UTC(),
	})
	if err != nil {
		return SubmitReportResult{}, err
	}

	var promotion *models.PromotionEvent
	if score.Score >= s.cfg.PromotionThreshold {
		event, err := s.createPromotion(ctx, PromotionInput{
			AgentID:     in.AgentID,
			Action:      "promote",
			Rationale:   fmt.Sprintf("score %.2f >= threshold %.2f", score.Score, s.cfg.PromotionThreshold),
			Confidence:  score.Confidence,
			RequestedBy: "eval-engine",
			Pool:        s.cfg.DefaultPool,
			Delta:       s.cfg.DefaultDelta,
		})
		if err != nil {
			return SubmitReportResult{}, fmt.Errorf("create promotion: %w", err)
		}
		promotion = &event
	}

	return SubmitReportResult{
		Report:    report,
		Score:     score,
		Promotion: promotion,
	}, nil
}

func computeScore(metricJSON json.RawMessage) (float64, json.RawMessage) {
	var metrics map[string]float64
	if err := json.Unmarshal(metricJSON, &metrics); err != nil {
		return 0, json.RawMessage(`{"error":"invalid metric payload"}`)
	}
	if len(metrics) == 0 {
		return 0, json.RawMessage(`{"components":[]}`)
	}
	sum := 0.0
	details := make([]map[string]interface{}, 0, len(metrics))
	for k, v := range metrics {
		sum += v
		details = append(details, map[string]interface{}{
			"metric": k,
			"value":  v,
		})
	}
	score := sum / float64(len(metrics))
	payload, _ := json.Marshal(map[string]interface{}{
		"components": details,
	})
	return clamp(score), payload
}

func computeConfidence(components json.RawMessage) float64 {
	var payload struct {
		Components []interface{} `json:"components"`
	}
	if err := json.Unmarshal(components, &payload); err != nil {
		return 0.5
	}
	n := len(payload.Components)
	if n == 0 {
		return 0.5
	}
	return clamp(0.5 + float64(n)/10.0)
}

func clamp(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return math.Round(v*100) / 100
}

type PromotionInput struct {
	AgentID     string
	Action      string
	Rationale   string
	Confidence  float64
	RequestedBy string
	Pool        string
	Delta       int
}

func (s *Service) CreateManualPromotion(ctx context.Context, in PromotionInput) (models.PromotionEvent, error) {
	return s.createPromotion(ctx, in)
}

func (s *Service) createPromotion(ctx context.Context, in PromotionInput) (models.PromotionEvent, error) {
	event, err := s.store.CreatePromotionEvent(ctx, store.PromotionInput{
		AgentID:     in.AgentID,
		Action:      in.Action,
		Rationale:   in.Rationale,
		Confidence:  in.Confidence,
		Status:      "pending",
		RequestedBy: in.RequestedBy,
	})
	if err != nil {
		return models.PromotionEvent{}, err
	}

	if s.alloc != nil {
		req := AllocationRequest{
			PromotionID: event.ID,
			AgentID:     in.AgentID,
			Pool:        in.Pool,
			Delta:       in.Delta,
			Reason:      in.Rationale,
			RequestedBy: in.RequestedBy,
		}
		resp, err := s.alloc.CreateRequest(ctx, req)
		if err == nil {
			_ = s.store.LinkPromotionAllocation(ctx, event.ID, resp.RequestID)
		}
	}

	return event, nil
}

func (s *Service) GetAgentScore(ctx context.Context, agentID string) (models.AgentScore, error) {
	return s.store.GetAgentScore(ctx, agentID)
}
