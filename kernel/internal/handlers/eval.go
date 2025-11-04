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

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// EvalReport is the minimal ingestion model for /kernel/eval
type EvalReport struct {
	Id        string                 `json:"id,omitempty"`
	AgentId   string                 `json:"agentId"`
	MetricSet map[string]interface{} `json:"metricSet"`
	Timestamp *time.Time             `json:"timestamp,omitempty"`
	Source    string                 `json:"source,omitempty"`
}

// POST /kernel/eval
// Accepts an EvalReport and persists it, then emits an audit event.
func handleEvalPost(cfg *config.Config, db *sql.DB, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req EvalReport
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		// Basic validation
		if req.AgentId == "" || req.MetricSet == nil {
			http.Error(w, "agentId and metricSet required", http.StatusBadRequest)
			return
		}
		// Ensure id and timestamp
		if req.Id == "" {
			req.Id = audit.NewUUID()
		}
		if req.Timestamp == nil {
			now := time.Now().UTC()
			req.Timestamp = &now
		}

		// persist
		if db != nil {
			if err := insertEvalToDB(r.Context(), db, &req); err != nil {
				http.Error(w, "db persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := writeEvalToFile(&req); err != nil {
				http.Error(w, "file persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// Emit audit event
		aev := &audit.AuditEvent{
			EventType: "eval.submitted",
			Payload: map[string]interface{}{
				"evalId":   req.Id,
				"agentId":  req.AgentId,
				"metricSet": req.MetricSet,
				"timestamp": req.Timestamp,
				"source":   req.Source,
			},
			Ts: time.Now().UTC(),
		}
		if err := store.AppendAuditEvent(r.Context(), aev, s); err != nil {
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Respond with accepted eval id
		writeJSON(w, http.StatusAccepted, map[string]string{"eval_id": req.Id})
	}
}

// persist helpers

func writeEvalToFile(rp *EvalReport) error {
	dir := "./data/evals"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", rp.Id))
	b, err := json.MarshalIndent(rp, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func insertEvalToDB(ctx context.Context, db *sql.DB, rp *EvalReport) error {
	payload, err := json.Marshal(rp.MetricSet)
	if err != nil {
		return err
	}
	q := `
		INSERT INTO eval_reports (id, agent_id, metric_set, timestamp, source)
		VALUES ($1, $2, $3::jsonb, $4, $5)
		ON CONFLICT (id) DO UPDATE SET metric_set = EXCLUDED.metric_set, timestamp = EXCLUDED.timestamp, source = EXCLUDED.source
	`
	_, err = db.ExecContext(ctx, q, rp.Id, rp.AgentId, payload, rp.Timestamp, rp.Source)
	return err
}

