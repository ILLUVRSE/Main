package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/config"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/service"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

type Server struct {
	cfg config.Config
	db  store.Store
	svc *service.Service
}

func New(cfg config.Config, db store.Store, svc *service.Service) *Server {
	return &Server{
		cfg: cfg,
		db:  db,
		svc: svc,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Get("/health", s.handleHealth)

	r.Route("/reason", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(s.writeAuthMiddleware)
			r.Post("/node", s.handleCreateNode)
			r.Post("/edge", s.handleCreateEdge)
			r.Post("/snapshot", s.handleCreateSnapshot)
		})

		r.Get("/node/{id}", s.handleGetNode)
		r.Get("/trace/{id}", s.handleTrace)
		r.Get("/snapshot/{id}", s.handleGetSnapshot)
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := map[string]interface{}{
		"ok":   true,
		"time": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := s.db.Ping(ctx); err != nil {
		status["ok"] = false
		status["db"] = "down"
		status["error"] = err.Error()
		respondJSON(w, http.StatusServiceUnavailable, status)
		return
	}
	status["db"] = "up"
	respondJSON(w, http.StatusOK, status)
}

type createNodeRequest struct {
	Type                string          `json:"type"`
	Payload             json.RawMessage `json:"payload"`
	Author              string          `json:"author"`
	Version             *string         `json:"version"`
	ManifestSignatureID *string         `json:"manifestSignatureId"`
	AuditEventID        *string         `json:"auditEventId"`
	Metadata            json.RawMessage `json:"metadata"`
}

func (s *Server) handleCreateNode(w http.ResponseWriter, r *http.Request) {
	var req createNodeRequest
	if err := decodeJSON(w, r, &req, int64(s.cfg.MaxNodePayloadBytes)); err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
		return
	}
	if req.Type == "" || len(req.Payload) == 0 || req.Author == "" {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "type, payload, and author are required")
		return
	}
	node, err := s.db.CreateNode(r.Context(), store.NodeInput{
		Type:                req.Type,
		Payload:             req.Payload,
		Author:              req.Author,
		Version:             req.Version,
		ManifestSignatureID: req.ManifestSignatureID,
		AuditEventID:        req.AuditEventID,
		Metadata:            req.Metadata,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"nodeId":    node.ID,
		"createdAt": node.CreatedAt,
	})
}

type createEdgeRequest struct {
	From     string          `json:"from"`
	To       string          `json:"to"`
	Type     string          `json:"type"`
	Weight   *float64        `json:"weight"`
	Metadata json.RawMessage `json:"metadata"`
}

func (s *Server) handleCreateEdge(w http.ResponseWriter, r *http.Request) {
	var req createEdgeRequest
	if err := decodeJSON(w, r, &req, 64*1024); err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
		return
	}
	fromID, err := uuid.Parse(req.From)
	if err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid from uuid")
		return
	}
	toID, err := uuid.Parse(req.To)
	if err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid to uuid")
		return
	}
	if req.Type == "" {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "type is required")
		return
	}
	edge, err := s.db.CreateEdge(r.Context(), store.EdgeInput{
		From:     fromID,
		To:       toID,
		Type:     req.Type,
		Weight:   req.Weight,
		Metadata: req.Metadata,
	})
	if err != nil {
		if strings.Contains(err.Error(), "foreign key constraint") {
			respondError(w, http.StatusNotFound, "REASONING_GRAPH_NOT_FOUND", "from or to node does not exist")
			return
		}
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"edgeId":    edge.ID,
		"createdAt": edge.CreatedAt,
	})
}

func (s *Server) handleGetNode(w http.ResponseWriter, r *http.Request) {
	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid node id")
		return
	}
	node, err := s.db.GetNode(r.Context(), nodeID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			respondError(w, http.StatusNotFound, "REASONING_GRAPH_NOT_FOUND", "node not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}
	incoming, err := s.db.ListEdgesTo(r.Context(), nodeID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}
	outgoing, err := s.db.ListEdgesFrom(r.Context(), nodeID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"node":     node,
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

func (s *Server) handleTrace(w http.ResponseWriter, r *http.Request) {
	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid node id")
		return
	}
	direction := models.TraceDirection(r.URL.Query().Get("direction"))
	if direction == "" {
		direction = models.TraceDirectionAncestors
	}
	depth := 0
	if depthStr := r.URL.Query().Get("depth"); depthStr != "" {
		if d, err := strconv.Atoi(depthStr); err == nil {
			depth = d
		}
	}
	trace, err := s.svc.ComputeTrace(r.Context(), nodeID, direction, depth)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrNotFound):
			respondError(w, http.StatusNotFound, "REASONING_GRAPH_NOT_FOUND", "node not found")
			return
		case errors.Is(err, service.ErrInvalidTraceDirection):
			respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
			return
		default:
			respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
			return
		}
	}
	respondJSON(w, http.StatusOK, trace)
}

type snapshotRequest struct {
	RootNodeIDs []string `json:"rootNodeIds"`
	Description *string  `json:"description"`
}

func (s *Server) handleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	var req snapshotRequest
	if err := decodeJSON(w, r, &req, 64*1024); err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
		return
	}
	if len(req.RootNodeIDs) == 0 {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "rootNodeIds required")
		return
	}
	roots := make([]uuid.UUID, 0, len(req.RootNodeIDs))
	for _, idStr := range req.RootNodeIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid root node id: "+idStr)
			return
		}
		roots = append(roots, id)
	}
	snapshot, err := s.svc.CreateSnapshot(r.Context(), service.SnapshotRequest{
		RootNodeIDs: roots,
		Description: req.Description,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmptySnapshotRoots):
			respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
			return
		case errors.Is(err, service.ErrTooManySnapshotRoots):
			respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", err.Error())
			return
		case errors.Is(err, store.ErrNotFound):
			respondError(w, http.StatusNotFound, "REASONING_GRAPH_NOT_FOUND", err.Error())
			return
		default:
			respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_DEPENDENCY", err.Error())
			return
		}
	}
	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"snapshotId": snapshot.ID,
		"hash":       snapshot.Hash,
		"signature":  snapshot.Signature,
		"signerId":   snapshot.SignerID,
		"createdAt":  snapshot.CreatedAt,
	})
}

func (s *Server) handleGetSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "REASONING_GRAPH_BAD_REQUEST", "invalid snapshot id")
		return
	}
	snapshot, err := s.db.GetSnapshot(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			respondError(w, http.StatusNotFound, "REASONING_GRAPH_NOT_FOUND", "snapshot not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", err.Error())
		return
	}

	format := r.URL.Query().Get("format")
	if strings.EqualFold(format, "human") {
		var payload struct {
			Nodes []models.ReasonNode `json:"nodes"`
			Edges []models.ReasonEdge `json:"edges"`
		}
		if err := json.Unmarshal(snapshot.Snapshot, &payload); err != nil {
			respondError(w, http.StatusInternalServerError, "REASONING_GRAPH_INTERNAL", "snapshot payload corrupted")
			return
		}
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"snapshot": snapshot,
			"human": map[string]interface{}{
				"nodeCount": len(payload.Nodes),
				"edgeCount": len(payload.Edges),
				"summary":   buildHumanSummary(payload.Nodes, payload.Edges),
			},
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"snapshot": snapshot,
	})
}

func buildHumanSummary(nodes []models.ReasonNode, edges []models.ReasonEdge) []map[string]interface{} {
	summary := make([]map[string]interface{}, 0, len(nodes))
	for _, node := range nodes {
		summary = append(summary, map[string]interface{}{
			"id":      node.ID,
			"type":    node.Type,
			"author":  node.Author,
			"created": node.CreatedAt,
		})
	}
	return summary
}

func (s *Server) writeAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.AllowDebugToken {
			if token := r.Header.Get("X-Debug-Token"); token != "" && token == s.cfg.DebugToken {
				next.ServeHTTP(w, r)
				return
			}
			respondError(w, http.StatusUnauthorized, "REASONING_GRAPH_AUTH", "debug token required")
			return
		}
		if r.TLS == nil {
			respondError(w, http.StatusUnauthorized, "REASONING_GRAPH_AUTH", "mtls required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v interface{}, limit int64) error {
	if limit <= 0 {
		limit = 1 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		return err
	}
	return nil
}

func respondJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func respondError(w http.ResponseWriter, status int, code, msg string) {
	respondJSON(w, status, map[string]string{
		"error": msg,
		"code":  code,
	})
}
