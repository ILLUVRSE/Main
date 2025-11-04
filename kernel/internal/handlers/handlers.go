package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// RegisterRoutes wires kernel HTTP routes.
//
// It accepts the AppContext instance from cmd/kernel/main.go (as an empty interface)
// and extracts the fields it needs via reflection: Config, DB, Signer, Store.
func RegisterRoutes(app interface{}, r chi.Router) {
	cfg, db, sgn, store, ok := extractDependencies(app)
	if !ok {
		panic("handlers.RegisterRoutes: expected AppContext with fields {Config *config.Config, DB *sql.DB, Signer signer.Signer, Store audit.Store}")
	}

	// public health endpoints
	r.Get("/health", handleHealth)
	r.Get("/ready", handleReady(cfg, db, store))

	// kernel endpoints (minimal Priority A)

	// Division routes (register + fetch)
	r.Post("/kernel/division", handleDivisionPost(cfg, db, sgn, store))
	r.Get("/kernel/division/{id}", handleDivisionGet(cfg, db, store))

	// Agent routes
	r.Post("/kernel/agent", handleAgentPost(cfg, db, sgn, store))
	r.Get("/kernel/agent/{id}/state", handleAgentGet(cfg, db, store))

	// Eval and Allocation
	r.Post("/kernel/eval", handleEvalPost(cfg, db, sgn, store))
	r.Post("/kernel/allocate", handleAllocatePost(cfg, db, sgn, store))

	// Sign & Audit
	r.Post("/kernel/sign", handleSign(sgn, store))
	r.Post("/kernel/audit", handleAuditPost(cfg, sgn, store))
	r.Get("/kernel/audit/{id}", handleAuditGet(store))

	// Reasoning trace
	r.Get("/kernel/reason/{node}", handleReasonGet(cfg, store))
}

// extractDependencies pulls Config, DB, Signer and Store from the provided app context value.
// Returns ok=false if the expected fields are missing or can't be asserted to the expected types.
func extractDependencies(app interface{}) (cfg *config.Config, db *sql.DB, sgn signer.Signer, store audit.Store, ok bool) {
	v := reflect.ValueOf(app)
	if !v.IsValid() {
		return nil, nil, nil, nil, false
	}
	// If pointer, dereference to struct
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return nil, nil, nil, nil, false
		}
		v = v.Elem()
	}
	// Config
	fCfg := v.FieldByName("Config")
	if !fCfg.IsValid() || fCfg.IsNil() {
		return nil, nil, nil, nil, false
	}
	cfgIface := fCfg.Interface()
	cfgp, okCfg := cfgIface.(*config.Config)
	if !okCfg {
		return nil, nil, nil, nil, false
	}
	cfg = cfgp

	// DB (optional)
	var dbp *sql.DB
	fDB := v.FieldByName("DB")
	if fDB.IsValid() && !fDB.IsNil() {
		if dbIface := fDB.Interface(); dbIface != nil {
			dbp, _ = dbIface.(*sql.DB)
		}
	}

	// Signer
	fSigner := v.FieldByName("Signer")
	if !fSigner.IsValid() || fSigner.IsNil() {
		return nil, nil, nil, nil, false
	}
	sgnIface := fSigner.Interface()
	sgnCast, okSigner := sgnIface.(signer.Signer)
	if !okSigner {
		return nil, nil, nil, nil, false
	}

	// Store
	fStore := v.FieldByName("Store")
	if !fStore.IsValid() || fStore.IsNil() {
		return nil, nil, nil, nil, false
	}
	storeIface := fStore.Interface()
	storeCast, okStore := storeIface.(audit.Store)
	if !okStore {
		return nil, nil, nil, nil, false
	}

	return cfg, dbp, sgnCast, storeCast, true
}

// --- Handlers ---

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "ts": time.Now().UTC()})
}

func handleReady(cfg *config.Config, db *sql.DB, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// prefer store ping; if DB present, also check DB
		if err := store.Ping(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "store not ready"})
			return
		}
		if db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := db.PingContext(ctx); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "db not ready"})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ready"})
	}
}

// POST /kernel/sign
// Request: { "manifest": {...}, "signerId":"...", "version":"1.0.0" }
// Response: ManifestSignature
func handleSign(s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Manifest interface{} `json:"manifest"`
			SignerId string      `json:"signerId"`
			Version  string      `json:"version"`
		}
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if req.Manifest == nil {
			http.Error(w, "manifest required", http.StatusBadRequest)
			return
		}

		// canonicalize
		canon, err := canonical.MarshalCanonical(req.Manifest)
		if err != nil {
			http.Error(w, "canonicalize error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// sign hash
		sum := sha256.Sum256(canon)
		sig, signerId, err := s.Sign(sum[:])
		if err != nil {
			http.Error(w, "sign error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// choose manifestId if present
		manifestId := ""
		if m, ok := req.Manifest.(map[string]interface{}); ok {
			if idv, ok := m["id"]; ok {
				if s2, ok := idv.(string); ok && s2 != "" {
					manifestId = s2
				}
			}
		}
		if manifestId == "" {
			manifestId = fmt.Sprintf("%x-%d", sum[:8], time.Now().Unix())
		}

		ms := audit.ManifestSignature{
			ManifestId: manifestId,
			SignerId:   signerId,
			Signature:  base64.StdEncoding.EncodeToString(sig),
			Version:    req.Version,
			Ts:         time.Now().UTC(),
		}

		if err := store.InsertManifestSignature(r.Context(), &ms); err != nil {
			http.Error(w, "store manifest signature: "+err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, ms)
	}
}

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
		if err := store.AppendAuditEvent(r.Context(), ev, s); err != nil {
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Accepting (202) to indicate append performed
		writeJSON(w, http.StatusAccepted, ev)
	}
}

func handleAuditGet(store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

// helper JSON writer
func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
