package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/config"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

type Server struct {
	cfg     config.Config
	service *service.Service
	store   store.Store
}

func New(cfg config.Config, svc *service.Service, store store.Store) *Server {
	return &Server{cfg: cfg, service: svc, store: store}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Get("/health", s.handleHealth)

	r.Route("/ai-infra", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(s.writeAuth)
			r.Post("/train", s.handleTrain)
			r.Post("/register", s.handleRegister)
			r.Post("/promote", s.handlePromote)
		})
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := map[string]interface{}{
		"ok":   true,
		"time": time.Now().UTC(),
	}
	if err := s.store.Ping(ctx); err != nil {
		status["ok"] = false
		status["db"] = err.Error()
		respondJSON(w, http.StatusServiceUnavailable, status)
		return
	}
	respondJSON(w, http.StatusOK, status)
}

type trainRequest struct {
	CodeRef         string          `json:"codeRef"`
	ContainerDigest string          `json:"containerDigest"`
	Hyperparams     json.RawMessage `json:"hyperparams"`
	DatasetRefs     json.RawMessage `json:"datasetRefs"`
	Seed            int64           `json:"seed"`
}

func (s *Server) handleTrain(w http.ResponseWriter, r *http.Request) {
	var req trainRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	job, err := s.service.CreateTrainingJob(r.Context(), service.TrainingJobRequest{
		CodeRef:         req.CodeRef,
		ContainerDigest: req.ContainerDigest,
		Hyperparams:     req.Hyperparams,
		DatasetRefs:     req.DatasetRefs,
		Seed:            req.Seed,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, job)
}

type registerRequest struct {
	TrainingJobID       string          `json:"trainingJobId"`
	ArtifactURI         string          `json:"artifactUri"`
	Checksum            string          `json:"checksum"`
	Metadata            json.RawMessage `json:"metadata"`
	ManifestSignatureID *string         `json:"manifestSignatureId"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	jobID, err := uuid.Parse(req.TrainingJobID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid trainingJobId")
		return
	}
	artifact, err := s.service.RegisterArtifact(r.Context(), service.RegisterArtifactRequest{
		TrainingJobID:       jobID,
		ArtifactURI:         req.ArtifactURI,
		Checksum:            req.Checksum,
		Metadata:            req.Metadata,
		ManifestSignatureID: req.ManifestSignatureID,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, artifact)
}

type promoteRequest struct {
	ArtifactID  string          `json:"artifactId"`
	Environment string          `json:"environment"`
	Evaluation  json.RawMessage `json:"evaluation"`
	RequestedBy string          `json:"requestedBy"`
}

func (s *Server) handlePromote(w http.ResponseWriter, r *http.Request) {
	var req promoteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	artifactID, err := uuid.Parse(req.ArtifactID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid artifactId")
		return
	}
	promo, err := s.service.PromoteArtifact(r.Context(), service.PromotionRequest{
		ArtifactID:  artifactID,
		Environment: req.Environment,
		Evaluation:  req.Evaluation,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, promo)
}

func (s *Server) writeAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.AllowDebugToken {
			if token := r.Header.Get("X-Debug-Token"); token != "" && token == s.cfg.DebugToken {
				next.ServeHTTP(w, r)
				return
			}
			respondError(w, http.StatusUnauthorized, "debug token required")
			return
		}
		if r.TLS == nil {
			respondError(w, http.StatusUnauthorized, "mtls required")
			return
		}
		next.ServeHTTP(w, r)
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

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}
