package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/audit"
)

// handleReasonGet returns a reasoning trace for a given node.
// Current implementation: file-backed stub that looks for ./data/reason/<node>.json
// Production: replace with a client call to the Reasoning Graph service.
func handleReasonGet(cfg *config.Config, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		node := chi.URLParam(r, "node")
		if node == "" {
			http.Error(w, "node required", http.StatusBadRequest)
			return
		}

		// Try file fallback: ./data/reason/<node>.json
		path := filepath.Join("./data/reason", fmt.Sprintf("%s.json", node))
		b, err := os.ReadFile(path)
		if err == nil {
			// Return the file contents as-is (assuming it contains the trace JSON)
			var payload interface{}
			if err := json.Unmarshal(b, &payload); err != nil {
				http.Error(w, "invalid trace JSON", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"node":  node,
				"trace": payload,
			})
			return
		}

		// If file not found, return 404. In the future we can query a DB or call Reasoning Graph.
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// Helper to create a sample trace file for local testing.
// Call this in your dev flow if you want a quick example (not used by handlers).
func createSampleTrace(node string, trace interface{}) error {
	dir := "./data/reason"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", node))
	b, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// Example: create a sample trace (not executed automatically).
func init() {
	// optionally create a tiny sample trace for local dev (comment/uncomment as needed)
	// _ = createSampleTrace("sample-node", map[string]interface{}{"steps": []string{"a","b","c"}, "createdAt": time.Now().UTC()})
	_ = time.Now() // keep import tidy if sample code commented
}

