package signing

import (
	"crypto/ed25519"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSigningProxyKMSSignAndVerify(t *testing.T) {
	payload := []byte("hello-kms")
	pub, priv, _ := ed25519.GenerateKey(crand.Reader)

	ts := newLockedDownServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sign":
			var req struct {
				PayloadB64 string `json:"payload_b64"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			data, _ := base64.StdEncoding.DecodeString(req.PayloadB64)
			sig := ed25519.Sign(priv, data)
			resp := map[string]string{
				"signature_b64": base64.StdEncoding.EncodeToString(sig),
				"signer_id":     "kms-signer-1",
			}
			_ = json.NewEncoder(w).Encode(resp)
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

	sigB64, signerID, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if signerID != "kms-signer-1" {
		t.Fatalf("unexpected signer id %q", signerID)
	}
	sig, _ := base64.StdEncoding.DecodeString(sigB64)
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatalf("signature did not verify with kms public key")
	}
	if err := sp.Verify(payload, sigB64, signerID); err != nil {
		t.Fatalf("Verify error: %v", err)
	}
}

func TestSigningProxyFallbackWhenKMSFails(t *testing.T) {
	payload := []byte("fallback-payload")
	pub, priv, _ := ed25519.GenerateKey(crand.Reader)
	privB64 := base64.StdEncoding.EncodeToString(priv)

	callCount := 0
	ts := newLockedDownServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer ts.Close()

	t.Setenv("KERNEL_KMS_ENDPOINT", ts.URL)
	t.Setenv("KERNEL_SIGNER_KEY_B64", privB64)

	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}

	sigB64, signerID, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if !strings.HasPrefix(signerID, localSignerPrefix) {
		t.Fatalf("expected local signer prefix, got %q", signerID)
	}
	if callCount == 0 {
		t.Fatalf("expected KMS endpoint to be attempted at least once")
	}
	sig, _ := base64.StdEncoding.DecodeString(sigB64)
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatalf("fallback signature did not verify with derived public key")
	}
	if err := sp.Verify(payload, sigB64, signerID); err != nil {
		t.Fatalf("Verify should succeed for fallback signature: %v", err)
	}
}

func TestSigningProxyLocalOnly(t *testing.T) {
	payload := []byte("local-only")
	_, priv, _ := ed25519.GenerateKey(crand.Reader)
	privB64 := base64.StdEncoding.EncodeToString(priv)

	t.Setenv("KERNEL_KMS_ENDPOINT", "")
	t.Setenv("KERNEL_SIGNER_KEY_B64", privB64)
	t.Setenv("KERNEL_CLIENT_CERT", "")
	t.Setenv("KERNEL_CLIENT_KEY", "")
	t.Setenv("KERNEL_CA_CERT", "")

	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}

	sigB64, signerID, err := sp.Sign(payload)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if !strings.HasPrefix(signerID, localSignerPrefix) {
		t.Fatalf("unexpected signer id %q", signerID)
	}

	if err := sp.Verify(payload, sigB64, signerID); err != nil {
		t.Fatalf("Verify error: %v", err)
	}
}

// Ensure env leakage doesn't cause failures when fallback key is absent.
func TestSigningProxyFailsWhenNoKMSAndNoKey(t *testing.T) {
	t.Setenv("KERNEL_KMS_ENDPOINT", "")
	t.Setenv("KERNEL_SIGNER_KEY_B64", "")
	sp, err := NewSigningProxyFromEnv()
	if err != nil {
		t.Fatalf("NewSigningProxyFromEnv error: %v", err)
	}
	if _, _, err := sp.Sign([]byte("data")); err == nil {
		t.Fatalf("expected signing to fail without KMS and fallback key")
	}
}

func TestReadValueOrFile_Base64(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("-----BEGIN TEST-----\n123\n-----END TEST-----\n"))
	b, err := readValueOrFile(encoded)
	if err != nil {
		t.Fatalf("readValueOrFile error: %v", err)
	}
	if !strings.Contains(string(b), "BEGIN TEST") {
		t.Fatalf("unexpected decoded content: %q", string(b))
	}
}

func TestReadValueOrFile_Path(t *testing.T) {
	tmp := t.TempDir()
	path := tmp + "/cert.pem"
	content := "-----BEGIN TEST-----\nabc\n-----END TEST-----\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}
	b, err := readValueOrFile(path)
	if err != nil {
		t.Fatalf("readValueOrFile error: %v", err)
	}
	if string(b) != content {
		t.Fatalf("unexpected file content: %q", string(b))
	}
}

// newLockedDownServer enforces IPv4 loopback listeners (IPv6 may be blocked in some sandboxes).
func newLockedDownServer(handler http.Handler) *httptest.Server {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	ts := &httptest.Server{
		Listener: ln,
		Config:   &http.Server{Handler: handler},
	}
	ts.Start()
	return ts
}
