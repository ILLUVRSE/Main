package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/ingestion"
	"github.com/ILLUVRSE/Main/eval-engine/internal/store"
)

type Server struct {
	service *ingestion.Service
	store   store.Store
}

func New(service *ingestion.Service, store store.Store) *Server {
	return &Server{
		service: service,
		store:   store,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Post("/eval/submit", s.handleSubmit)
	r.Get("/eval/agent/{id}/score", s.handleGetScore)
	r.Get("/eval/scoreboard", s.handleScoreboard)
	r.Post("/eval/promote", s.handlePromote)
	r.Post("/eval/retrain", s.handleCreateRetrain)
	r.Get("/eval/jobs/{id}", s.handleGetJob)

	return r
}

type submitRequest struct {
	AgentID    string          `json:"agentId"`
	DivisionID string          `json:"divisionId"`
	Metrics    json.RawMessage `json:"metrics"`
	Source     string          `json:"source"`
	Tags       json.RawMessage `json:"tags"`
	TS         *time.Time      `json:"timestamp"`
}

func (s *Server) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var req submitRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	ts := time.Now().UTC()
	if req.TS != nil {
		ts = req.TS.UTC()
	}
	result, err := s.service.SubmitReport(r.Context(), ingestion.SubmitReportInput{
		AgentID:    req.AgentID,
		DivisionID: req.DivisionID,
		Metrics:    req.Metrics,
		Source:     req.Source,
		Tags:       req.Tags,
		TS:         ts,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	resp := map[string]interface{}{
		"reportId": result.Report.ID,
		"score":    result.Score,
	}
	if result.Promotion != nil {
		resp["promotion"] = result.Promotion
	}
	respondJSON(w, http.StatusOK, resp)
}

func (s *Server) handleGetScore(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	score, err := s.service.GetAgentScore(r.Context(), agentID)
	if err != nil {
		if err == store.ErrNotFound {
			respondError(w, http.StatusNotFound, "score not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, score)
}

func (s *Server) handleScoreboard(w http.ResponseWriter, r *http.Request) {
	divisionID := r.URL.Query().Get("divisionId")
	limit := 10
	if val := r.URL.Query().Get("topK"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			limit = n
		}
	}
	scores, err := s.service.GetScoreboard(r.Context(), divisionID, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"scores": scores,
	})
}

type promoteRequest struct {
	AgentID     string  `json:"agentId"`
	Rationale   string  `json:"rationale"`
	Confidence  float64 `json:"confidence"`
	RequestedBy string  `json:"requestedBy"`
	Pool        string  `json:"pool"`
	Delta       int     `json:"delta"`
}

func (s *Server) handlePromote(w http.ResponseWriter, r *http.Request) {
	var req promoteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	event, err := s.service.CreateManualPromotion(r.Context(), ingestion.PromotionInput{
		AgentID:     req.AgentID,
		Action:      "promote",
		Rationale:   req.Rationale,
		Confidence:  req.Confidence,
		RequestedBy: req.RequestedBy,
		Pool:        req.Pool,
		Delta:       req.Delta,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, event)
}

type retrainRequest struct {
	ModelFamily   string          `json:"modelFamily"`
	DatasetRefs   []string        `json:"datasetRefs"`
	Priority      string          `json:"priority"`
	RequestedBy   string          `json:"requestedBy"`
	ResourcePool  string          `json:"resourcePool"`
	ResourceUnits int             `json:"resourceUnits"`
	ResultMetrics json.RawMessage `json:"resultMetrics"`
}

func (s *Server) handleCreateRetrain(w http.ResponseWriter, r *http.Request) {
	var req retrainRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	job, err := s.service.CreateRetrainJob(r.Context(), ingestion.RetrainJobInput{
		ModelFamily:   req.ModelFamily,
		DatasetRefs:   req.DatasetRefs,
		Priority:      req.Priority,
		RequestedBy:   req.RequestedBy,
		ResourcePool:  req.ResourcePool,
		ResourceUnits: req.ResourceUnits,
		ResultMetrics: req.ResultMetrics,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, job)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid job id")
		return
	}
	job, err := s.service.GetRetrainJob(r.Context(), id)
	if err != nil {
		if err == store.ErrNotFound {
			respondError(w, http.StatusNotFound, "job not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, job)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v interface{}) error {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return err
	}
	return nil
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}

func respondJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
