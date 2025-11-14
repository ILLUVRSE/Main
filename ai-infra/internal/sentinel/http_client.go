package sentinel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type HTTPClientConfig struct {
	BaseURL    string
	Path       string
	Timeout    time.Duration
	Retries    int
	HTTPClient *http.Client
}

type HTTPClient struct {
	baseURL string
	path    string
	client  *http.Client
	timeout time.Duration
	retries int
}

func NewHTTPClient(cfg HTTPClientConfig) (*HTTPClient, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("sentinel base url required")
	}
	path := cfg.Path
	if path == "" {
		path = "/sentinelnet/check"
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	retries := cfg.Retries
	if retries < 0 {
		retries = 0
	}
	return &HTTPClient{
		baseURL: strings.TrimSuffix(cfg.BaseURL, "/"),
		path:    path,
		client:  client,
		timeout: timeout,
		retries: retries,
	}, nil
}

func (c *HTTPClient) Check(ctx context.Context, req Request) (Decision, error) {
	payload := map[string]interface{}{
		"artifactId":  req.ArtifactID,
		"environment": req.Environment,
		"evaluation":  req.Evaluation,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return Decision{}, fmt.Errorf("sentinel marshal request: %w", err)
	}

	attempts := c.retries + 1
	var lastErr error
	for i := 0; i < attempts; i++ {
		if ctx.Err() != nil {
			return Decision{}, ctx.Err()
		}
		reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
		httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, c.baseURL+c.path, bytes.NewReader(body))
		if err != nil {
			cancel()
			return Decision{}, fmt.Errorf("sentinel build request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		resp, err := c.client.Do(httpReq)
		cancel()
		if err != nil {
			lastErr = err
		} else {
			decision, parseErr := decodeDecision(resp)
			resp.Body.Close()
			if parseErr == nil {
				return decision, nil
			}
			lastErr = parseErr
		}
		if i < attempts-1 {
			time.Sleep(time.Duration(i+1) * 100 * time.Millisecond)
		}
	}
	return Decision{}, fmt.Errorf("sentinel check failed: %w", lastErr)
}

func decodeDecision(resp *http.Response) (Decision, error) {
	if resp.StatusCode >= 500 {
		return Decision{}, fmt.Errorf("sentinel unavailable: %s", resp.Status)
	}
	if resp.StatusCode != http.StatusOK {
		return Decision{}, fmt.Errorf("sentinel rejected request: %s", resp.Status)
	}
	var decision Decision
	if err := json.NewDecoder(resp.Body).Decode(&decision); err != nil {
		return Decision{}, fmt.Errorf("sentinel decode response: %w", err)
	}
	return decision, nil
}
