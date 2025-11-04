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

// AllocationRequest is the minimal request model for /kernel/allocate
type AllocationRequest struct {
	Id         string    `json:"id,omitempty"`
	DivisionId string    `json:"divisionId"`
	CPU        int       `json:"cpu,omitempty"`
	GPU        int       `json:"gpu,omitempty"`
	MemoryMB   int       `json:"memoryMB,omitempty"`
	Requester  string    `json:"requester,omitempty"`
	Status     string    `json:"status,omitempty"` // pending|applied|rejected
	Reason     string    `json:"reason,omitempty"`
	CreatedAt  time.Time `json:"createdAt,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
}

// POST /kernel/allocate
// Accepts an AllocationRequest, persists it, and emits an audit event.
func handleAllocatePost(cfg *config.Config, db *sql.DB, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req AllocationRequest
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		// Basic validation
		if req.DivisionId == "" {
			http.Error(w, "divisionId required", http.StatusBadRequest)
			return
		}

		// ensure id and timestamps
		if req.Id == "" {
			req.Id = audit.NewUUID()
		}
		now := time.Now().UTC()
		if req.CreatedAt.IsZero() {
			req.CreatedAt = now
		}
		req.UpdatedAt = now
		if req.Status == "" {
			req.Status = "pending"
		}

		// persist
		if db != nil {
			if err := insertAllocationToDB(r.Context(), db, &req); err != nil {
				http.Error(w, "db persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := writeAllocationToFile(&req); err != nil {
				http.Error(w, "file persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// emit audit event
		aev := &audit.AuditEvent{
			EventType: "allocation.requested",
			Payload: map[string]interface{}{
				"allocationId": req.Id,
				"divisionId":   req.DivisionId,
				"cpu":          req.CPU,
				"gpu":          req.GPU,
				"memoryMB":     req.MemoryMB,
				"requester":    req.Requester,
				"status":       req.Status,
				"reason":       req.Reason,
			},
			Ts: time.Now().UTC(),
		}
		if err := store.AppendAuditEvent(r.Context(), aev, s); err != nil {
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"allocationId": req.Id,
			"status":       req.Status,
		})
	}
}

// persistence helpers

func writeAllocationToFile(a *AllocationRequest) error {
	dir := "./data/allocations"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", a.Id))
	b, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func insertAllocationToDB(ctx context.Context, db *sql.DB, a *AllocationRequest) error {
	payload, err := json.Marshal(a)
	if err != nil {
		return err
	}
	q := `
		INSERT INTO allocations (id, division_id, cpu, gpu, memory_mb, requester, status, reason, created_at, updated_at, payload)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (id) DO UPDATE SET cpu = EXCLUDED.cpu, gpu = EXCLUDED.gpu, memory_mb = EXCLUDED.memory_mb, requester = EXCLUDED.requester, status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
	`
	_, err = db.ExecContext(ctx, q,
		a.Id, a.DivisionId, a.CPU, a.GPU, a.MemoryMB, a.Requester,
		a.Status, a.Reason, a.CreatedAt, a.UpdatedAt, payload,
	)
	return err
}
