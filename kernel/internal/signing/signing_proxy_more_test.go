package signing

import (
	"crypto/ed25519"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// TestSigningProxyKMSRetryThenSuccess verifies that postWithRetry retries on
// 5xx and succeeds when KMS returns 200 on a subsequent attempt.
func TestSigningProxyKMSRetryThenSuccess(t *testing.T) {
	payload := []byte("retry-payload")
	pub, priv, _ := ed25519.GenerateKey(crand.Reader)

	call := 0
	ts := newLockedDownServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sign":
			call++
			if call == 1 {
				http.Error(w, "boom", http.StatusInternalServerError)
				return
			}
			var req struct {
				PayloadB64 string `json:"payload_b64"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			data, _ := base64.StdEncoding.DecodeString(req.PayloadB64)
			sig := ed25519.Sign(priv, data)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"signature_b64": base64.StdEncoding.EncodeToString(sig),
				"signer_id":     "kms-retry",
			})
		case "/verify":
			var req struct {
				PayloadB64   string `json:"payload_b64"`
				SignatureB64 string `json:"signature_b64"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			data, _ := base64.StdEncoding.DecodeString(req.PayloadB64)
			sig, _ := base64.StdEncoding.DecodeString(req.SignatureB64)
			verified := ed25519.Verify(pub, data, sig)
			_ = json.NewEncoder(w).Encode(map[string]bool{"verified": verified})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	t.Setenv("KERNEL_KMS_ENDPOINT", ts.URL)
	t.Setenv("KMS_TIMEOUT_MS", "2000")

	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}

	sigB64, signer, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if signer != "kms-retry" {
		t.Fatalf("unexpected signer id %q", signer)
	}
	sig, _ := base64.StdEncoding.DecodeString(sigB64)
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatalf("signature did not verify with kms public key")
	}

	if err := sp.Verify(payload, sigB64, signer); err != nil {
		t.Fatalf("Verify error: %v", err)
	}
}

// TestVerifyWithKMSReturnsFalse ensures Verify returns an error when KMS
// responds with verified=false.
func TestVerifyWithKMSReturnsFalse(t *testing.T) {
	payload := []byte("verify-false")
	pub, priv, _ := ed25519.GenerateKey(crand.Reader)

	ts := newLockedDownServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sign":
			var req struct {
				PayloadB64 string `json:"payload_b64"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			data, _ := base64.StdEncoding.DecodeString(req.PayloadB64)
			sig := ed25519.Sign(priv, data)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"signature_b64": base64.StdEncoding.EncodeToString(sig),
				"signer_id":     "kms-signer",
			})
		case "/verify":
			_ = json.NewEncoder(w).Encode(map[string]bool{"verified": false})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	t.Setenv("KERNEL_KMS_ENDPOINT", ts.URL)
	t.Setenv("KMS_TIMEOUT_MS", "2000")

	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}

	sigB64, signer, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if sigB64 == "" || signer == "" {
		t.Fatalf("unexpected empty sign response")
	}

	if err := sp.Verify(payload, sigB64, signer); err == nil {
		t.Fatalf("expected Verify to fail when KMS returns verified=false")
	}
}

// TestSigningProxyKMSMalformedJSONFallback verifies a malformed JSON response
// from KMS causes fallback to the local Ed25519 key when available.
func TestSigningProxyKMSMalformedJSONFallback(t *testing.T) {
	payload := []byte("malformed")
	_, priv, _ := ed25519.GenerateKey(crand.Reader)
	privB64 := base64.StdEncoding.EncodeToString(priv)

	ts := newLockedDownServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sign" {
			// Return a 200 with invalid JSON
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("not-json"))
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()

	t.Setenv("KERNEL_KMS_ENDPOINT", ts.URL)
	t.Setenv("KERNEL_SIGNER_KEY_B64", privB64)
	t.Setenv("KMS_TIMEOUT_MS", "2000")

	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}

	sigB64, signer, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if !strings.HasPrefix(signer, localSignerPrefix) {
		t.Fatalf("expected local signer prefix, got %q", signer)
	}
	sig, _ := base64.StdEncoding.DecodeString(sigB64)
	pub, err := derivePublicKey(privB64)
	if err != nil {
		t.Fatalf("derivePublicKey error: %v", err)
	}
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatalf("fallback signature did not verify with derived public key")
	}
}

