package store

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/models"
)

// MemoryStore provides an in-memory implementation useful for tests.
type MemoryStore struct {
	mu             sync.RWMutex
	reports        map[uuid.UUID]models.EvalReport
	scores         map[string]models.AgentScore
	promotions     map[uuid.UUID]models.PromotionEvent
	allocationReqs map[uuid.UUID]models.AllocationRequest
	retrainJobs    map[uuid.UUID]models.RetrainJob
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		reports:        map[uuid.UUID]models.EvalReport{},
		scores:         map[string]models.AgentScore{},
		promotions:     map[uuid.UUID]models.PromotionEvent{},
		allocationReqs: map[uuid.UUID]models.AllocationRequest{},
		retrainJobs:    map[uuid.UUID]models.RetrainJob{},
	}
}

func copyJSON(raw json.RawMessage) json.RawMessage {
	if raw == nil {
		return json.RawMessage(`{}`)
	}
	return append(json.RawMessage(nil), raw...)
}

func (m *MemoryStore) InsertEvalReport(ctx context.Context, in EvalReportInput) (models.EvalReport, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	report := models.EvalReport{
		ID:        in.ID,
		AgentID:   in.AgentID,
		MetricSet: copyJSON(in.MetricSet),
		Source:    in.Source,
		Tags:      copyJSON(in.Tags),
		TS:        in.TS,
		CreatedAt: time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reports[report.ID] = report
	return report, nil
}

func (m *MemoryStore) UpsertAgentScore(ctx context.Context, in AgentScoreInput) (models.AgentScore, error) {
	score := models.AgentScore{
		AgentID:    in.AgentID,
		DivisionID: in.DivisionID,
		Score:      in.Score,
		Components: copyJSON(in.Components),
		Confidence: in.Confidence,
		Window:     in.Window,
		ComputedAt: in.ComputedAt,
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.scores[in.AgentID] = score
	return score, nil
}

func (m *MemoryStore) GetAgentScore(ctx context.Context, agentID string) (models.AgentScore, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	score, ok := m.scores[agentID]
	if !ok {
		return models.AgentScore{}, ErrNotFound
	}
	return score, nil
}

func (m *MemoryStore) ListTopAgentScores(ctx context.Context, divisionID string, limit int) ([]models.AgentScore, error) {
	if limit <= 0 {
		limit = 10
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	var scores []models.AgentScore
	for _, score := range m.scores {
		if divisionID != "" && !strings.EqualFold(score.DivisionID, divisionID) {
			continue
		}
		scores = append(scores, score)
	}
	sort.Slice(scores, func(i, j int) bool {
		if scores[i].Score == scores[j].Score {
			return scores[i].ComputedAt.After(scores[j].ComputedAt)
		}
		return scores[i].Score > scores[j].Score
	})
	if len(scores) > limit {
		scores = scores[:limit]
	}
	return append([]models.AgentScore(nil), scores...), nil
}

func (m *MemoryStore) CreatePromotionEvent(ctx context.Context, in PromotionInput) (models.PromotionEvent, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	event := models.PromotionEvent{
		ID:          in.ID,
		AgentID:     in.AgentID,
		Action:      in.Action,
		Rationale:   in.Rationale,
		Confidence:  in.Confidence,
		Status:      in.Status,
		RequestedBy: in.RequestedBy,
		CreatedAt:   time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.promotions[event.ID] = event
	return event, nil
}

func (m *MemoryStore) LinkPromotionAllocation(ctx context.Context, promotionID, allocationID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	event, ok := m.promotions[promotionID]
	if !ok {
		return ErrNotFound
	}
	event.AllocationRequestID = &allocationID
	m.promotions[promotionID] = event
	return nil
}

func (m *MemoryStore) CreateAllocationRequest(ctx context.Context, in AllocationInput) (models.AllocationRequest, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	req := models.AllocationRequest{
		ID:          in.ID,
		PromotionID: in.PromotionID,
		AgentID:     in.AgentID,
		Pool:        in.Pool,
		Delta:       in.Delta,
		Reason:      in.Reason,
		Status:      in.Status,
		RequestedBy: in.RequestedBy,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.allocationReqs[req.ID] = req
	return req, nil
}

func (m *MemoryStore) UpdateAllocationStatus(ctx context.Context, in AllocationStatusUpdate) (models.AllocationRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	req, ok := m.allocationReqs[in.ID]
	if !ok {
		return models.AllocationRequest{}, ErrNotFound
	}
	req.Status = in.Status
	if len(in.SentinelDecision) > 0 {
		req.SentinelDecision = copyJSON(in.SentinelDecision)
	}
	if in.AppliedBy != nil {
		req.AppliedBy = in.AppliedBy
	}
	if in.AppliedAt != nil {
		req.AppliedAt = in.AppliedAt
	}
	req.UpdatedAt = time.Now().UTC()
	m.allocationReqs[in.ID] = req
	return req, nil
}

func (m *MemoryStore) GetAllocationRequest(ctx context.Context, id uuid.UUID) (models.AllocationRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	req, ok := m.allocationReqs[id]
	if !ok {
		return models.AllocationRequest{}, ErrNotFound
	}
	return req, nil
}

func (m *MemoryStore) CreateRetrainJob(ctx context.Context, in RetrainJobInput) (models.RetrainJob, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	job := models.RetrainJob{
		ID:            in.ID,
		ModelFamily:   in.ModelFamily,
		DatasetRefs:   append([]string(nil), in.DatasetRefs...),
		Priority:      in.Priority,
		Status:        in.Status,
		RequestedBy:   in.RequestedBy,
		ResultMetrics: copyJSON(in.Result),
		CreatedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.retrainJobs[job.ID] = job
	return job, nil
}

func (m *MemoryStore) GetRetrainJob(ctx context.Context, id uuid.UUID) (models.RetrainJob, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.retrainJobs[id]
	if !ok {
		return models.RetrainJob{}, ErrNotFound
	}
	return job, nil
}

func (m *MemoryStore) AttachRetrainAllocation(ctx context.Context, jobID, allocationID uuid.UUID) (models.RetrainJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.retrainJobs[jobID]
	if !ok {
		return models.RetrainJob{}, ErrNotFound
	}
	job.AllocationRequestID = &allocationID
	job.UpdatedAt = time.Now().UTC()
	m.retrainJobs[jobID] = job
	return job, nil
}

func (m *MemoryStore) Ping(ctx context.Context) error {
	return nil
}
