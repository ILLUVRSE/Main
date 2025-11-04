package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// DivisionManifest is a lightweight struct used for the API.
// The repo contains a more complete spec in kernel/data-models.md.
// We keep a flexible payload to accept arbitrary manifests.
type DivisionManifest map[string]interface{}

// POST /kernel/division
// Request body: DivisionManifest (JSON)
// Response: { manifest: <manifest>, manifestSignature: <ManifestSignature> }
func handleDivisionPost(cfg *config.Config, db *sql.DB, s signer.Signer, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// parse manifest
		var manifest DivisionManifest
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&manifest); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}

		// ---- Minimal schema guard to align with OpenAPI expectations ----
		// Require "id" and "name" as non-empty strings.
		idStr, idOK := manifest["id"].(string)
		nameStr, nameOK := manifest["name"].(string)
		if !idOK || idStr == "" || !nameOK || nameStr == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid DivisionManifest: id and name are required"}`))
			return
		}
		manifestId := idStr

		// canonicalize manifest
		canon, err := canonical.MarshalCanonical(manifest)
		if err != nil {
			http.Error(w, "canonicalize error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// compute hash and sign
		sum := sha256.Sum256(canon)
		sigBytes, signerId, err := s.Sign(sum[:])
		if err != nil {
			http.Error(w, "sign error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// persist manifest signature
		ms := audit.ManifestSignature{
			ManifestId: manifestId,
			SignerId:   signerId,
			Signature:  encodeBase64(sigBytes),
			Version:    "", // optional: can be provided in request manifest
			Ts:         time.Now().UTC(),
		}
		if err := store.InsertManifestSignature(r.Context(), &ms); err != nil {
			http.Error(w, "store manifest signature: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// persist manifest itself: prefer DB if available, otherwise file store
		if db != nil {
			if err := upsertDivisionToDB(r.Context(), db, manifestId, manifest); err != nil {
				http.Error(w, "db persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			if err := upsertDivisionToFile(manifestId, manifest); err != nil {
				http.Error(w, "file persist error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// emit audit event for manifest update
		aev := &audit.AuditEvent{
			EventType: "manifest.update",
			Payload: map[string]interface{}{
				"manifest":            manifest,
				"manifestSignatureId": ms.ID,
			},
			Ts: time.Now().UTC(),
		}
		if err := store.AppendAuditEvent(r.Context(), aev, s); err != nil {
			// Audit failure should surface but not hide success of register — return 500 to be strict.
			http.Error(w, "append audit event: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// respond with manifest + signature
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"manifest":          manifest,
			"manifestSignature": ms,
		})
	}
}

// GET /kernel/division/{id}
// Returns the manifest JSON if present.
func handleDivisionGet(cfg *config.Config, db *sql.DB, store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}

		// Prefer DB
		if db != nil {
			manifest, err := fetchDivisionFromDB(r.Context(), db, id)
			if err == nil {
				writeJSON(w, http.StatusOK, map[string]interface{}{"manifest": manifest})
				return
			}
			// If DB query failed with not found, continue to file fallback; else return error
			if err != sql.ErrNoRows {
				http.Error(w, "db error: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		// fallback to file
		manifest, err := fetchDivisionFromFile(id)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"manifest": manifest})
	}
}

// --- helpers ---

func encodeBase64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

func upsertDivisionToFile(id string, manifest DivisionManifest) error {
	dir := "./data/divisions"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", id))
	b, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func fetchDivisionFromFile(id string) (DivisionManifest, error) {
	path := filepath.Join("./data/divisions", fmt.Sprintf("%s.json", id))
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m DivisionManifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func upsertDivisionToDB(ctx context.Context, db *sql.DB, id string, manifest DivisionManifest) error {
	// Ensure manifest JSON
	mj, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	// Upsert (requires migrations that create divisions table with primary key on id)
	q := `
		INSERT INTO divisions (id, manifest, created_at, updated_at)
		VALUES ($1, $2::jsonb, now(), now())
		ON CONFLICT (id) DO UPDATE SET manifest = EXCLUDED.manifest, updated_at = now()
	`
	_, err = db.ExecContext(ctx, q, id, mj)
	return err
}

func fetchDivisionFromDB(ctx context.Context, db *sql.DB, id string) (DivisionManifest, error) {
	var mj []byte
	q := `SELECT manifest FROM divisions WHERE id=$1`
	if err := db.QueryRowContext(ctx, q, id).Scan(&mj); err != nil {
		return nil, err
	}
	var m DivisionManifest
	if err := json.Unmarshal(mj, &m); err != nil {
		return nil, err
	}
	return m, nil
}
