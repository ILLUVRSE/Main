package api

import (
	"encoding/json"
	"net/http"

	"github.com/ILLUVRSE/Main/eval-engine/internal/service"
	"github.com/go-chi/chi/v5"
)

type PromotionHandler struct {
	svc *service.PromotionService
}

func NewPromotionHandler(svc *service.PromotionService) *PromotionHandler {
	return &PromotionHandler{svc: svc}
}

func (h *PromotionHandler) RegisterRoutes(r chi.Router) {
	r.Post("/eval/promote", h.HandlePromote)
	r.Post("/alloc/request", h.HandleAllocate)
}

func (h *PromotionHandler) HandlePromote(w http.ResponseWriter, r *http.Request) {
	var req service.PromotionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	promo, err := h.svc.Promote(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":           true,
		"promotion_id": promo.ID,
		"status":       promo.Status,
	})
}

func (h *PromotionHandler) HandleAllocate(w http.ResponseWriter, r *http.Request) {
	var req service.AllocationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	alloc, err := h.svc.Allocate(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":            true,
		"allocation_id": alloc.ID,
		"status":        alloc.Status,
		"details":       alloc.Resources,
	})
}
