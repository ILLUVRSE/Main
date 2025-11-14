package allocator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/eval-engine/internal/ingestion"
)

type Client struct {
	baseURL string
	client  *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

type requestPayload struct {
	PromotionID *uuid.UUID `json:"promotionId,omitempty"`
	AgentID     string     `json:"agentId"`
	Pool        string     `json:"pool"`
	Delta       int        `json:"delta"`
	Reason      string     `json:"reason"`
	RequestedBy string     `json:"requestedBy"`
}

type responsePayload struct {
	RequestID uuid.UUID `json:"requestId"`
	Status    string    `json:"status"`
}

func (c *Client) CreateRequest(ctx context.Context, req ingestion.AllocationRequest) (ingestion.AllocationResponse, error) {
	payload := requestPayload{
		PromotionID: req.PromotionID,
		AgentID:     req.AgentID,
		Pool:        req.Pool,
		Delta:       req.Delta,
		Reason:      req.Reason,
		RequestedBy: req.RequestedBy,
	}
	body, _ := json.Marshal(payload)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/alloc/request", c.baseURL), bytes.NewReader(body))
	if err != nil {
		return ingestion.AllocationResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(httpReq)
	if err != nil {
		return ingestion.AllocationResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return ingestion.AllocationResponse{}, fmt.Errorf("allocator returned %s", resp.Status)
	}
	var parsed responsePayload
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return ingestion.AllocationResponse{}, err
	}
	return ingestion.AllocationResponse{
		RequestID: parsed.RequestID,
		Status:    parsed.Status,
	}, nil
}
