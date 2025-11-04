package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// MaxJSONBody is the default maximum size for a JSON request body (1 MiB).
const MaxJSONBody = 1 << 20 // 1MiB

// BindJSON reads the request body (up to MaxJSONBody bytes), decodes JSON into dst,
// and enforces strict decoding: unknown fields cause an error. It also rejects
// multiple top-level JSON values.
//
// It writes no response itself; the caller should translate returned errors into HTTP responses.
func BindJSON(w http.ResponseWriter, r *http.Request, dst interface{}) error {
	// limit body size
	r.Body = http.MaxBytesReader(w, r.Body, MaxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		// Return a clear error message
		if err == io.EOF {
			return fmt.Errorf("request body must not be empty")
		}
		return fmt.Errorf("invalid JSON: %w", err)
	}
	// Ensure there is only a single JSON value
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain only a single JSON object")
	}
	return nil
}

