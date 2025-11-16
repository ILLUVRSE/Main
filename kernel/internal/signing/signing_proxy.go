package signing

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// SigningProxy signs payloads by delegating to a KMS HTTP endpoint with an mTLS-capable client.
// If the endpoint is not configured or fails, it falls back to a local Ed25519 key provided via env.
type SigningProxy struct {
	client   *http.Client
	endpoint string
	keyB64   string
	keyID    string
}

const (
	defaultKMSTimeout = 3 * time.Second
	localSignerPrefix = "local-ed25519:"
)

// kmsSignResponse is the expected KMS /sign response contract.
type kmsSignResponse struct {
	SignatureB64 string `json:"signature_b64"`
	SignerID     string `json:"signer_id"`
}

// kmsVerifyResponse matches the optional KMS /verify contract.
type kmsVerifyResponse struct {
	Verified bool `json:"verified"`
}

// NewSigningProxyFromEnv builds a SigningProxy using environment-driven configuration.
// Environment variables:
//   - KERNEL_KMS_ENDPOINT: base URL of the KMS service (no trailing slash required)
//   - KERNEL_KMS_KEY_ID: optional logical key identifier passed through to KMS
//   - KERNEL_SIGNER_KEY_B64: base64-encoded Ed25519 private key (fallback dev path)
//   - KERNEL_CLIENT_CERT / KERNEL_CLIENT_KEY / KERNEL_CA_CERT: PEM contents or file paths for mTLS
//   - KMS_TIMEOUT_MS: optional request timeout in milliseconds (default 3000ms)
func NewSigningProxyFromEnv() (*SigningProxy, error) {
	endpoint := strings.TrimRight(os.Getenv("KERNEL_KMS_ENDPOINT"), "/")
	keyID := os.Getenv("KERNEL_KMS_KEY_ID")
	keyB64 := os.Getenv("KERNEL_SIGNER_KEY_B64")
	timeout := defaultKMSTimeout
	if v := os.Getenv("KMS_TIMEOUT_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			timeout = time.Duration(ms) * time.Millisecond
		} else {
			log.Printf("[signing] invalid KMS_TIMEOUT_MS=%q; using default %s", v, defaultKMSTimeout)
		}
	}

	certEnv := os.Getenv("KERNEL_CLIENT_CERT")
	keyEnv := os.Getenv("KERNEL_CLIENT_KEY")
	caEnv := os.Getenv("KERNEL_CA_CERT")

	client, err := buildHTTPClient(certEnv, keyEnv, caEnv, timeout)
	if err != nil {
		return nil, err
	}

	return &SigningProxy{
		client:   client,
		endpoint: endpoint,
		keyB64:   keyB64,
		keyID:    keyID,
	}, nil
}

// Sign signs the provided payload. It prefers KMS; on failure (or when no endpoint is configured)
// it falls back to the local Ed25519 key if available.
func (s *SigningProxy) Sign(payload []byte) (string, string, error) {
	if len(payload) == 0 {
		return "", "", errors.New("signing payload is empty")
	}

	// Attempt KMS first if configured.
	if s.endpoint != "" {
		if sig, signer, err := s.signWithKMS(payload); err == nil {
			return sig, signer, nil
		} else {
			log.Printf("[signing] KMS signing failed: %v; attempting fallback", err)
		}
	}

	// Fallback to local Ed25519
	return s.signWithLocal(payload)
}

// Verify validates the provided signature for the payload. If the signerId indicates a local
// signature, verification is performed locally. Otherwise a KMS /verify call is attempted.
func (s *SigningProxy) Verify(payload []byte, signatureB64 string, signerID string) error {
	if strings.HasPrefix(signerID, localSignerPrefix) {
		return s.verifyLocal(payload, signatureB64)
	}

	if s.endpoint == "" {
		return errors.New("KMS endpoint not configured; cannot verify remote signature")
	}

	return s.verifyWithKMS(payload, signatureB64, signerID)
}

func (s *SigningProxy) signWithKMS(payload []byte) (string, string, error) {
	if s.client == nil {
		return "", "", errors.New("http client not configured")
	}
	url := s.endpoint + "/sign"

	reqBody := map[string]string{
		"payload_b64": base64.StdEncoding.EncodeToString(payload),
	}
	if s.keyID != "" {
		reqBody["key_id"] = s.keyID
	}

	var resp kmsSignResponse
	if err := s.postWithRetry(url, reqBody, &resp); err != nil {
		return "", "", err
	}

	if resp.SignatureB64 == "" || resp.SignerID == "" {
		return "", "", errors.New("kms response missing signature or signer_id")
	}

	return resp.SignatureB64, resp.SignerID, nil
}

func (s *SigningProxy) verifyWithKMS(payload []byte, signatureB64 string, signerID string) error {
	if s.client == nil {
		return errors.New("http client not configured")
	}
	url := s.endpoint + "/verify"

	reqBody := map[string]string{
		"payload_b64":   base64.StdEncoding.EncodeToString(payload),
		"signature_b64": signatureB64,
		"signer_id":     signerID,
	}

	var resp kmsVerifyResponse
	if err := s.postWithRetry(url, reqBody, &resp); err != nil {
		return err
	}
	if !resp.Verified {
		return errors.New("kms verification failed")
	}
	return nil
}

func (s *SigningProxy) signWithLocal(payload []byte) (string, string, error) {
	priv, pub, err := decodeEd25519Key(s.keyB64)
	if err != nil {
		return "", "", fmt.Errorf("ed25519 fallback unavailable: %w", err)
	}
	sig := ed25519.Sign(priv, payload)
	signerID := fmt.Sprintf("%s%x", localSignerPrefix, shortSHA(pub))
	return base64.StdEncoding.EncodeToString(sig), signerID, nil
}

func (s *SigningProxy) verifyLocal(payload []byte, signatureB64 string) error {
	pub, err := derivePublicKey(s.keyB64)
	if err != nil {
		return fmt.Errorf("ed25519 verify failed: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		return fmt.Errorf("invalid base64 signature: %w", err)
	}
	if !ed25519.Verify(pub, payload, sig) {
		return errors.New("signature verification failed")
	}
	return nil
}

// postWithRetry performs a POST with a single retry on transient errors or 5xx responses.
func (s *SigningProxy) postWithRetry(url string, body interface{}, out interface{}) error {
	var lastErr error
	backoff := 100 * time.Millisecond
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}
		if err := s.postJSON(url, body, out); err != nil {
			lastErr = err
			var netErr net.Error
			if errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary()) {
				continue
			}
			var httpErr *httpStatusError
			if errors.As(err, &httpErr) && httpErr.ShouldRetry() {
				continue
			}
			return err
		}
		return nil
	}
	return lastErr
}

func (s *SigningProxy) postJSON(url string, body interface{}, out interface{}) error {
	buf := &bytes.Buffer{}
	if err := json.NewEncoder(buf).Encode(body); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.client.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &httpStatusError{StatusCode: resp.StatusCode, Body: string(b)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("kms returned http %d: %s", resp.StatusCode, string(b))
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("kms decode error: %w", err)
		}
	}
	return nil
}

// buildHTTPClient constructs an HTTP client with optional mTLS.
func buildHTTPClient(certEnv, keyEnv, caEnv string, timeout time.Duration) (*http.Client, error) {
	tlsCfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	if certEnv != "" && keyEnv != "" {
		certPEM, err := readValueOrFile(certEnv)
		if err != nil {
			return nil, fmt.Errorf("failed to read client cert: %w", err)
		}
		keyPEM, err := readValueOrFile(keyEnv)
		if err != nil {
			return nil, fmt.Errorf("failed to read client key: %w", err)
		}
		cert, err := tls.X509KeyPair(certPEM, keyPEM)
		if err != nil {
			return nil, fmt.Errorf("failed to load client certificate/key: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	} else {
		log.Printf("[signing] mTLS client cert/key not provided; proceeding without client auth")
	}

	if caEnv != "" {
		caPEM, err := readValueOrFile(caEnv)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA cert: %w", err)
		}
		cp := x509.NewCertPool()
		if !cp.AppendCertsFromPEM(caPEM) {
			return nil, errors.New("failed to parse CA certificate")
		}
		tlsCfg.RootCAs = cp
	}

	transport := &http.Transport{
		TLSClientConfig: tlsCfg,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}, nil
}

// readValueOrFile returns the raw bytes of the provided string. If the string points to an existing
// file path the file contents are returned; otherwise the string itself is treated as PEM content.
func readValueOrFile(value string) ([]byte, error) {
	if value == "" {
		return nil, errors.New("value is empty")
	}
	if _, err := os.Stat(value); err == nil {
		return os.ReadFile(value)
	}
	if strings.Contains(value, "BEGIN") {
		return []byte(value), nil
	}
	// Best-effort base64 decode support for CI-provided secrets.
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	return []byte(value), nil
}

// decodeEd25519Key decodes a base64 private key into an ed25519 keypair.
func decodeEd25519Key(keyB64 string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(keyB64))
	if err != nil {
		return nil, nil, fmt.Errorf("unable to decode base64 key: %w", err)
	}
	switch len(data) {
	case ed25519.SeedSize:
		priv := ed25519.NewKeyFromSeed(data)
		return priv, priv.Public().(ed25519.PublicKey), nil
	case ed25519.PrivateKeySize:
		priv := ed25519.PrivateKey(data)
		return priv, priv.Public().(ed25519.PublicKey), nil
	default:
		return nil, nil, fmt.Errorf("unexpected ed25519 private key length %d", len(data))
	}
}

func derivePublicKey(keyB64 string) (ed25519.PublicKey, error) {
	_, pub, err := decodeEd25519Key(keyB64)
	return pub, err
}

func shortSHA(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:4] // first 8 hex chars
}

type httpStatusError struct {
	StatusCode int
	Body       string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("kms http %d: %s", e.StatusCode, e.Body)
}

func (e *httpStatusError) ShouldRetry() bool {
	return e.StatusCode >= 500 && e.StatusCode < 600
}
