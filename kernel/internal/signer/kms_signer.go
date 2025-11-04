package signer

import (
	"bytes"
	"context"
	"crypto/ed25519"
	crand "crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// kmsSigner implements Signer by delegating signing to an external KMS.
type kmsSigner struct {
	endpoint    string
	client      *http.Client
	signerId    string
	bearerToken string
	requireKMS  bool
	publicKey   []byte
}

// NewKMSSigner creates a KMS-backed signer. If kmsEndpoint is empty and requireKMS is true,
// an error is returned. If kmsEndpoint is empty and requireKMS is false, (nil, nil) is returned
// so callers may fall back to a local signer.
func NewKMSSigner(kmsEndpoint string, requireKMS bool) (Signer, error) {
	kmsEndpoint = strings.TrimRight(kmsEndpoint, "/")
	if kmsEndpoint == "" {
		if requireKMS {
			return nil, fmt.Errorf("REQUIRE_KMS=true but KMS_ENDPOINT not set")
		}
		return nil, nil
	}

	// Environment-driven configuration (kept small and explicit)
	signerId := os.Getenv("SIGNER_ID")
	if signerId == "" {
		signerId = "kernel-signer-kms"
	}
	bearer := os.Getenv("KMS_BEARER_TOKEN")

	timeoutMs := 5000
	if v := os.Getenv("KMS_TIMEOUT_MS"); v != "" {
		if t, err := strconv.Atoi(v); err == nil && t > 0 {
			timeoutMs = t
		}
	}

	certPath := os.Getenv("KMS_MTLS_CERT_PATH")
	keyPath := os.Getenv("KMS_MTLS_KEY_PATH")
	caPath := os.Getenv("KMS_MTLS_CA_PATH")

	var tlsCfg *tls.Config
	if certPath != "" && keyPath != "" {
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			if requireKMS {
				return nil, fmt.Errorf("failed to load mTLS cert/key: %w", err)
			}
			// proceed without client certs
		} else {
			tlsCfg = &tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			}
			if caPath != "" {
				caPEM, err := os.ReadFile(caPath)
				if err != nil {
					if requireKMS {
						return nil, fmt.Errorf("failed to read KMS_MTLS_CA_PATH: %w", err)
					}
				} else {
					cp := x509.NewCertPool()
					if !cp.AppendCertsFromPEM(caPEM) {
						if requireKMS {
							return nil, fmt.Errorf("failed to parse CA bundle at %s", caPath)
						}
					} else {
						tlsCfg.RootCAs = cp
					}
				}
			}
		}
	} else {
		// If only CA path is provided, set RootCAs so server certs are validated against it.
		if caPath != "" {
			caPEM, err := os.ReadFile(caPath)
			if err != nil {
				if requireKMS {
					return nil, fmt.Errorf("failed to read KMS_MTLS_CA_PATH: %w", err)
				}
			} else {
				cp := x509.NewCertPool()
				if cp.AppendCertsFromPEM(caPEM) {
					tlsCfg = &tls.Config{
						RootCAs:    cp,
						MinVersion: tls.VersionTLS12,
					}
				}
			}
		}
	}

	tr := &http.Transport{TLSClientConfig: tlsCfg}
	client := &http.Client{
		Transport: tr,
		Timeout:   time.Duration(timeoutMs) * time.Millisecond,
	}

	ks := &kmsSigner{
		endpoint:    kmsEndpoint,
		client:      client,
		signerId:    signerId,
		bearerToken: bearer,
		requireKMS:  requireKMS,
	}

	// Best-effort public key fetch. If REQUIRE_KMS=true and we cannot fetch, fail.
	if pk := ks.fetchPublicKey(); pk != nil {
		ks.publicKey = pk
	} else if requireKMS {
		return nil, fmt.Errorf("failed to obtain public key from KMS")
	}

	return ks, nil
}

// PublicKey returns the cached public key (may be nil if KMS did not provide one).
func (k *kmsSigner) PublicKey() []byte {
	return k.publicKey
}

// Sign requests a signature for the provided hash bytes from the KMS /signData endpoint.
// If KMS is unavailable and REQUIRE_KMS=false, it falls back to an ephemeral local signature
// (development-only).
func (k *kmsSigner) Sign(hash []byte) ([]byte, string, error) {
	if k == nil || k.endpoint == "" {
		return nil, "", errors.New("kms signer not configured")
	}

	reqBody := map[string]string{
		"signerId": k.signerId,
		"data":     base64.StdEncoding.EncodeToString(hash),
	}

	var resp map[string]interface{}
	ctx, cancel := context.WithTimeout(context.Background(), k.client.Timeout)
	defer cancel()

	if err := k.postJSON(ctx, k.endpoint+"/signData", reqBody, &resp); err != nil {
		if k.requireKMS {
			return nil, "", fmt.Errorf("KMS signData error: %w", err)
		}
		// Dev fallback: ephemeral signature
		sig, sid := ephemeralSign(hash, k.signerId)
		return sig, sid, nil
	}

	// Accept common response shapes: {"signature": "..."} or {"sig":"..."}
	sigStr := ""
	if v, ok := resp["signature"].(string); ok && v != "" {
		sigStr = v
	} else if v, ok := resp["sig"].(string); ok && v != "" {
		sigStr = v
	}
	if sigStr == "" {
		if k.requireKMS {
			return nil, "", errors.New("KMS returned no signature")
		}
		sig, sid := ephemeralSign(hash, k.signerId)
		return sig, sid, nil
	}

	sigBytes, err := base64.StdEncoding.DecodeString(sigStr)
	if err != nil {
		if k.requireKMS {
			return nil, "", fmt.Errorf("invalid base64 signature from KMS: %w", err)
		}
		sig, sid := ephemeralSign(hash, k.signerId)
		return sig, sid, nil
	}

	sid := k.signerId
	if v, ok := resp["signerId"].(string); ok && v != "" {
		sid = v
	} else if v, ok := resp["signer_id"].(string); ok && v != "" {
		sid = v
	}

	return sigBytes, sid, nil
}

// fetchPublicKey attempts to obtain the signer's public key from KMS via POST /publicKey.
// Expected response: { "publicKey": "<base64>" }
// Returns nil on any failure.
func (k *kmsSigner) fetchPublicKey() []byte {
	if k == nil || k.endpoint == "" {
		return nil
	}
	req := map[string]string{"signerId": k.signerId}
	var resp struct {
		PublicKey string `json:"publicKey"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), k.client.Timeout)
	defer cancel()
	if err := k.postJSON(ctx, k.endpoint+"/publicKey", req, &resp); err != nil {
		return nil
	}
	if resp.PublicKey == "" {
		return nil
	}
	pk, err := base64.StdEncoding.DecodeString(resp.PublicKey)
	if err != nil {
		return nil
	}
	return pk
}

func (k *kmsSigner) postJSON(ctx context.Context, url string, in interface{}, out interface{}) error {
	buf := &bytes.Buffer{}
	if err := json.NewEncoder(buf).Encode(in); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if k.bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+k.bearerToken)
	}

	resp, err := k.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("KMS HTTP %d: %s", resp.StatusCode, string(b))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// ephemeralSign creates an ephemeral ed25519 keypair and signs the provided hash.
// This is strictly for development fallback and MUST NOT be used in production.
func ephemeralSign(hash []byte, signerId string) ([]byte, string) {
	_, priv, _ := ed25519.GenerateKey(crand.Reader)
	sig := ed25519.Sign(priv, hash)
	return sig, signerId
}
