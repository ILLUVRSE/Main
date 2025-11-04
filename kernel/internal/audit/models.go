// package audit contains the canonical models used by the Kernel audit subsystem.
package audit

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ManifestSignature represents that a manifest was signed by a signer (Ed25519).
type ManifestSignature struct {
	ID         string    `json:"id,omitempty"`
	ManifestId string    `json:"manifestId"`
	SignerId   string    `json:"signerId"`
	Signature  string    `json:"signature"` // base64-encoded signature
	Version    string    `json:"version,omitempty"`
	Ts         time.Time `json:"ts"`
}

// AuditEvent is the canonical audit record stored in the audit log.
type AuditEvent struct {
	ID        string      `json:"id,omitempty"`
	EventType string      `json:"eventType"`
	Payload   interface{} `json:"payload"`
	PrevHash  string      `json:"prevHash,omitempty"`
	Hash      string      `json:"hash,omitempty"`
	Signature string      `json:"signature,omitempty"`
	SignerId  string      `json:"signerId,omitempty"`
	Ts        time.Time   `json:"ts"`
	Metadata  interface{} `json:"metadata,omitempty"`
}

// ErrNotFound is returned when a requested audit resource cannot be located.
var ErrNotFound = errors.New("not found")

// NewUUID returns a freshly-generated UUID string.
func NewUUID() string {
	return uuid.New().String()
}

