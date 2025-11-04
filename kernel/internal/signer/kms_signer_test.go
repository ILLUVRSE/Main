package signer_test

import (
	"crypto/ed25519"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	signerpkg "github.com/ILLUVRSE/Main/kernel/internal/signer"
)

func TestKMSSignerSign_Simple(t *testing.T) {
	// generate a keypair the fake KMS will use to sign requests
	pub, priv, _ := ed25519.GenerateKey(crand.Reader)

	// simple httptest server that implements /signData
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path != "/signData" {
			http.NotFound(w, r)
			return
		}

		var req struct {
			SignerId string `json:"signerId"`
			Data     string `json:"data"` // base64-encoded
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		data, err := base64.StdEncoding.DecodeString(req.Data)
		if err != nil {
			http.Error(w, "bad base64", http.StatusBadRequest)
			return
		}
		sig := ed25519.Sign(priv, data)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"signature": base64.StdEncoding.EncodeToString(sig),
			"signerId":  req.SignerId,
		})
	}))
	defer ts.Close()

	// ensure deterministic signerId for test
	os.Setenv("SIGNER_ID", "test-signer")
	defer os.Unsetenv("SIGNER_ID")

	ks, err := signerpkg.NewKMSSigner(ts.URL, false) // REQUIRE_KMS=false for test
	if err != nil {
		t.Fatalf("NewKMSSigner err: %v", err)
	}
	if ks == nil {
		t.Fatalf("expected kms signer, got nil")
	}

	data := []byte("the-hash")
	sig, sid, err := ks.Sign(data)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if sid != "test-signer" {
		t.Fatalf("unexpected signerId: %s", sid)
	}
	if !ed25519.Verify(pub, data, sig) {
		t.Fatalf("signature verification failed")
	}
}
