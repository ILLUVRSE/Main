package keys

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// KeyInfo is the public metadata exposed for a signer.
type KeyInfo struct {
	SignerId  string    `json:"signerId"`
	Algorithm string    `json:"algorithm"` // e.g., "Ed25519"
	PublicKey string    `json:"publicKey"` // base64-encoded
	CreatedAt time.Time `json:"createdAt"`
}

// Registry is a small in-memory registry of signer public keys.
// It is safe for concurrent access.
type Registry struct {
	mtx  sync.RWMutex
	keys map[string]KeyInfo
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{
		keys: make(map[string]KeyInfo),
	}
}

// AddSigner registers a signer with its public key bytes and algorithm.
// If the signerId already exists, it will overwrite the entry.
func (r *Registry) AddSigner(signerId string, pubKey []byte, algorithm string) {
	r.mtx.Lock()
	defer r.mtx.Unlock()
	r.keys[signerId] = KeyInfo{
		SignerId:  signerId,
		Algorithm: algorithm,
		PublicKey: base64.StdEncoding.EncodeToString(pubKey),
		CreatedAt: time.Now().UTC(),
	}
}

// GetSigner returns a copy of KeyInfo for the given signerId and true, or nil,false if missing.
func (r *Registry) GetSigner(signerId string) (*KeyInfo, bool) {
	r.mtx.RLock()
	defer r.mtx.RUnlock()
	ki, ok := r.keys[signerId]
	if !ok {
		return nil, false
	}
	// return copy
	c := ki
	return &c, true
}

// ListSigners returns a slice of all signer infos.
func (r *Registry) ListSigners() []KeyInfo {
	r.mtx.RLock()
	defer r.mtx.RUnlock()
	out := make([]KeyInfo, 0, len(r.keys))
	for _, v := range r.keys {
		out = append(out, v)
	}
	return out
}

// StatusHandler returns an HTTP handler that exposes registry data as JSON.
// Response: { "signers": [ KeyInfo, ... ] }
func (r *Registry) StatusHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		signers := r.ListSigners()
		resp := map[string]interface{}{"signers": signers}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
