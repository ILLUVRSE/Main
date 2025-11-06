package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/auth"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// AgentProfile is a flexible representation used by the API.
type AgentProfile map[string]interface{}

// POST /kernel/agent
// Creates an agent (id optional). Production: require Operator or SuperAdmin.
func handleAgentPost(cfg *config.Config, db *sql.DB, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Production RBAC: Operator or SuperAdmin
		if os.Getenv("NODE_ENV") == "production" {
			ai := auth.FromContext(r.Context())
			if ai == nil {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
			if !auth.HasRole(ai, auth.RoleSuperAdmin) && !auth.HasRole(ai, auth.RoleOperator) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}

		var body AgentProfile
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&body); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if body == nil {
			http.Error(w, "body required", http.StatusBadRequest)
			return
		}

		// Determine id
		id, _ := body["id"].(string)
		if id == "" {
			id = fmt.Sprintf("agent-%d", time.Now().UnixNano())
			body["id"] = id
		}

		// Persist
		if db != nil {
			if err := upsertAgentToDB(r.Context(), db, id, body); err != nil {
				http.Error(w, "db persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := upsertAgentToFile(id, body); err != nil {
				http.Error(w, "file persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// emit audit event
		aev := &audit.AuditEvent{
			EventType: "agent.spawn",
			Payload:   map[string]interface{}{"agentId": id, "payload": body},
			Ts:        time.Now().UTC(),
		}
		if err := store.AppendAuditEvent(r.Context(), aev, s); err != nil {
			// surface failure
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Return created
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": id})
	}
}

// GET /kernel/agent/{id}/state
// Returns a minimal agent state. Production: require authenticated principal.
func handleAgentGet(cfg *config.Config, db *sql.DB, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Production: require authenticated principal
		if os.Getenv("NODE_ENV") == "production" {
			ai := auth.FromContext(r.Context())
			if ai == nil {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
		}

		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}

		// Try DB first
		if db != nil {
			if profile, err := fetchAgentFromDB(r.Context(), db, id); err == nil {
				writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "state": profile})
				return
			} else {
				if err != sql.ErrNoRows {
					http.Error(w, "db error: "+err.Error(), http.StatusInternalServerError)
					return
				}
			}
		}

		// Fallback to file
		profile, err := fetchAgentFromFile(id)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "state": profile})
	}
}

// --- file & DB helpers for agents ---

func upsertAgentToFile(id string, profile AgentProfile) error {
	dir := "./data/agents"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", id))
	b, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func fetchAgentFromFile(id string) (AgentProfile, error) {
	path := filepath.Join("./data/agents", fmt.Sprintf("%s.json", id))
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p AgentProfile
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	return p, nil
}

func upsertAgentToDB(ctx context.Context, db *sql.DB, id string, profile AgentProfile) error {
	// ensure JSON
	mj, err := json.Marshal(profile)
	if err != nil {
		return err
	}
	q := `
		INSERT INTO agents (id, profile, created_at, updated_at)
		VALUES ($1, $2::jsonb, now(), now())
		ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
	`
	_, err = db.ExecContext(ctx, q, id, mj)
	return err
}

func fetchAgentFromDB(ctx context.Context, db *sql.DB, id string) (AgentProfile, error) {
	var mj []byte
	q := `SELECT profile FROM agents WHERE id = $1`
	if err := db.QueryRowContext(ctx, q, id).Scan(&mj); err != nil {
		return nil, err
	}
	var p AgentProfile
	if err := json.Unmarshal(mj, &p); err != nil {
		return nil, err
	}
	return p, nil
}
