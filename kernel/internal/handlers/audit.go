package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/auth"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// POST /kernel/audit
// Accepts { eventType: string, payload: object, metadata?: object }
// If REQUIRE_MTLS is true the request must be TLS with a peer cert (checked by main's TLS setup).
func handleAuditPost(cfg *config.Config, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// mTLS guard if configured (main should configure TLS)
		if cfg.RequireMTLS {
			if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
				http.Error(w, "mTLS required", http.StatusUnauthorized)
				return
			}
		}

		// In production, require an authenticated principal (any authenticated principal).
		if os.Getenv("NODE_ENV") == "production" {
			ai := auth.FromContext(r.Context())
			if ai == nil {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
		}

		var req struct {
			EventType string      `json:"eventType"`
			Payload   interface{} `json:"payload"`
			Metadata  interface{} `json:"metadata,omitempty"`
		}
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if req.EventType == "" {
			http.Error(w, "eventType required", http.StatusBadRequest)
			return
		}

		ev := &audit.AuditEvent{
			EventType: req.EventType,
			Payload:   req.Payload,
			Metadata:  req.Metadata,
			Ts:        time.Now().UTC(),
		}

		// Append the event. AppendAuditEvent will perform durability semantics (DB/Kafka/S3).
		if err := store.AppendAuditEvent(r.Context(), ev, s); err != nil {
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Return 202 Accepted to indicate we appended the event (durable pipeline may stream it).
		writeJSON(w, http.StatusAccepted, ev)
	}
}

// GET /kernel/audit/{id}
// Production: only SuperAdmin or Auditor allowed.
func handleAuditGet(store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Production RBAC: only SuperAdmin or Auditor
		if os.Getenv("NODE_ENV") == "production" {
			ai := auth.FromContext(r.Context())
			if ai == nil {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
			if !auth.HasRole(ai, auth.RoleSuperAdmin) && !auth.HasRole(ai, auth.RoleAuditor) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}

		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}
		ev, err := store.GetAuditEvent(r.Context(), id)
		if err != nil {
			if err == audit.ErrNotFound {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, "get audit: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, ev)
	}
}
