package httpserver

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/allocator"
)

type Server struct {
	service *allocator.Service
}

func New(service *allocator.Service) *Server {
	return &Server{service: service}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Post("/alloc/request", s.handleRequest)
	r.Post("/alloc/approve", s.handleApprove)
	r.Get("/alloc/{id}", s.handleGet)
	r.Get("/alloc/pools", s.handlePools)

	return r
}

type requestBody struct {
	PromotionID *uuid.UUID `json:"promotionId"`
	AgentID     string     `json:"agentId"`
	Pool        string     `json:"pool"`
	Delta       int        `json:"delta"`
	Reason      string     `json:"reason"`
	RequestedBy string     `json:"requestedBy"`
}

func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
	var body requestBody
	if err := decodeJSON(w, r, &body); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	req, err := s.service.RequestAllocation(r.Context(), allocator.RequestInput{
		PromotionID: body.PromotionID,
		AgentID:     body.AgentID,
		Pool:        body.Pool,
		Delta:       body.Delta,
		Reason:      body.Reason,
		RequestedBy: body.RequestedBy,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"requestId": req.ID,
		"status":    req.Status,
	})
}

type approveBody struct {
	RequestID  uuid.UUID `json:"requestId"`
	ApprovedBy string    `json:"approvedBy"`
}

func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request) {
	var body approveBody
	if err := decodeJSON(w, r, &body); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	record, err := s.service.Approve(r.Context(), allocator.ApproveInput{
		RequestID:  body.RequestID,
		ApprovedBy: body.ApprovedBy,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, record)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid id")
		return
	}
	record, err := s.service.GetRequest(r.Context(), id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, record)
}

func (s *Server) handlePools(w http.ResponseWriter, r *http.Request) {
	pools, _ := s.service.Pools(r.Context())
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"pools": pools,
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func respondJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}
