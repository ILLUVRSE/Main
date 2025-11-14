package signing

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type KMSSignerConfig struct {
	Endpoint   string
	HTTPClient *http.Client
	Timeout    time.Duration
	Retries    int
}

type KMSSigner struct {
	endpoint string
	client   *http.Client
	timeout  time.Duration
	retries  int

	mu       sync.RWMutex
	signerID string
}

func NewKMSSigner(cfg KMSSignerConfig) (*KMSSigner, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("kms endpoint required")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: 10 * time.Second,
		}
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	retries := cfg.Retries
	if retries < 0 {
		retries = 0
	}
	endpoint := strings.TrimSuffix(cfg.Endpoint, "/")
	return &KMSSigner{
		endpoint: endpoint,
		client:   client,
		timeout:  timeout,
		retries:  retries,
	}, nil
}

func (k *KMSSigner) Sign(ctx context.Context, payload []byte) ([]byte, error) {
	reqBody := map[string]string{
		"payload_b64": base64.StdEncoding.EncodeToString(payload),
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("kms marshal request: %w", err)
	}

	attempts := k.retries + 1
	var signed []byte
	var lastErr error
	for i := 0; i < attempts; i++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		reqCtx, cancel := context.WithTimeout(ctx, k.timeout)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, k.endpoint+"/sign", bytes.NewReader(bodyBytes))
		if err != nil {
			cancel()
			return nil, fmt.Errorf("kms request build: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := k.client.Do(req)
		cancel()
		if err != nil {
			lastErr = err
		} else {
			func() {
				defer resp.Body.Close()
				if resp.StatusCode >= 500 {
					lastErr = fmt.Errorf("kms signer unavailable: %s", resp.Status)
					return
				}
				if resp.StatusCode != http.StatusOK {
					lastErr = fmt.Errorf("kms signer rejected request: %s", resp.Status)
					return
				}
				var kmsResp struct {
					SignatureB64 string `json:"signature_b64"`
					SignerID     string `json:"signer_id"`
				}
				if err := json.NewDecoder(resp.Body).Decode(&kmsResp); err != nil {
					lastErr = fmt.Errorf("kms decode response: %w", err)
					return
				}
				sigBytes, err := base64.StdEncoding.DecodeString(kmsResp.SignatureB64)
				if err != nil {
					lastErr = fmt.Errorf("kms decode signature: %w", err)
					return
				}
				if kmsResp.SignerID != "" {
					k.mu.Lock()
					k.signerID = kmsResp.SignerID
					k.mu.Unlock()
				}
				lastErr = nil
				signed = sigBytes
			}()
			if lastErr == nil {
				return signed, nil
			}
		}

		if i < attempts-1 {
			time.Sleep(time.Duration(i+1) * 100 * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("kms sign failed: %w", lastErr)
}

func (k *KMSSigner) SignerID() string {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.signerID
}
