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
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// AgentRequest is the minimal payload for /kernel/agent POST
type AgentRequest struct {
	TemplateId string                 `json:"templateId"`
	DivisionId string                 `json:"divisionId"`
	Overrides  map[string]interface{} `json:"overrides,omitempty"`
	Requester  string                 `json:"requester,omitempty"`
	Role       string                 `json:"role,omitempty"`
	CodeRef    string                 `json:"codeRef,omitempty"`
}

// AgentProfile is a minimal runtime record returned by GET /kernel/agent/{id}/state
type AgentProfile struct {
	Id               string                 `json:"id"`
	TemplateId       string                 `json:"templateId,omitempty"`
	Role             string                 `json:"role,omitempty"`
	DivisionId       string                 `json:"divisionId,omitempty"`
	CodeRef          string                 `json:"codeRef,omitempty"`
	State            string                 `json:"state,omitempty"`
	ResourceAllocation map[string]interface{} `json:"resourceAllocation,omitempty"`
	LastHeartbeat    *time.Time             `json:"lastHeartbeat,omitempty"`
	CreatedAt        time.Time              `json:"createdAt"`
	UpdatedAt        time.Time              `json:"updatedAt"`
	Owner            string                 `json:"owner,omitempty"`
}

// POST /kernel/agent
func handleAgentPost(cfg *config.Config, db *sql.DB, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req AgentRequest
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		if req.TemplateId == "" || req.DivisionId == "" {
			http.Error(w, "templateId and divisionId required", http.StatusBadRequest)
			return
		}

		agentId := audit.NewUUID()
		now := time.Now().UTC()
		profile := &AgentProfile{
			Id:        agentId,
			TemplateId: req.TemplateId,
			DivisionId: req.DivisionId,
			Role:      req.Role,
			CodeRef:   req.CodeRef,
			State:     "created",
			CreatedAt: now,
			UpdatedAt: now,
			Owner:     req.Requester,
		}

		// persist
		if db != nil {
			if err := insertAgentToDB(r.Context(), db, profile); err != nil {
				http.Error(w, "db persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := writeAgentToFile(profile); err != nil {
				http.Error(w, "file persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// Emit audit event: agent.instantiated (even though created state)
		aev := &audit.AuditEvent{
			EventType: "agent.instantiated",
			Payload: map[string]interface{}{
				"agentId":    profile.Id,
				"templateId": profile.TemplateId,
				"divisionId": profile.DivisionId,
				"owner":      profile.Owner,
				"role":       profile.Role,
				"codeRef":    profile.CodeRef,
				"state":      profile.State,
			},
			Ts: time.Now().UTC(),
		}
		if err := store.AppendAuditEvent(r.Context(), aev, s); err != nil {
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"agentId": agentId,
			"status":  "accepted",
		})
	}
}

// GET /kernel/agent/{id}/state
func handleAgentGet(cfg *config.Config, db *sql.DB, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}

		var profile *AgentProfile
		var err error
		if db != nil {
			profile, err = fetchAgentFromDB(r.Context(), db, id)
			if err != nil {
				if err == sql.ErrNoRows {
					// fallback to file
					profile, err = fetchAgentFromFile(id)
					if err != nil {
						http.Error(w, "not found", http.StatusNotFound)
						return
					}
				} else {
					http.Error(w, "db error: "+err.Error(), http.StatusInternalServerError)
					return
				}
			}
		} else {
			profile, err = fetchAgentFromFile(id)
			if err != nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
		}

		writeJSON(w, http.StatusOK, profile)
	}
}

// persistence helpers (simple file-backed and DB implementations)

// writeAgentToFile stores agent profile under ./data/agents/<id>.json
func writeAgentToFile(p *AgentProfile) error {
	dir := "./data/agents"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", p.Id))
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func fetchAgentFromFile(id string) (*AgentProfile, error) {
	path := filepath.Join("./data/agents", fmt.Sprintf("%s.json", id))
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p AgentProfile
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func insertAgentToDB(ctx context.Context, db *sql.DB, p *AgentProfile) error {
	payload, err := json.Marshal(p)
	if err != nil {
		return err
	}
	q := `
	INSERT INTO agents (id, profile, created_at, updated_at)
	VALUES ($1, $2::jsonb, now(), now())
	ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
	`
	_, err = db.ExecContext(ctx, q, p.Id, payload)
	return err
}

func fetchAgentFromDB(ctx context.Context, db *sql.DB, id string) (*AgentProfile, error) {
	var mj []byte
	q := `SELECT profile FROM agents WHERE id=$1`
	if err := db.QueryRowContext(ctx, q, id).Scan(&mj); err != nil {
		return nil, err
	}
	var p AgentProfile
	if err := json.Unmarshal(mj, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

