package allocator

import (
	"context"
	"encoding/json"
	"strings"
)

type SentinelDecision struct {
	Allowed  bool   `json:"allowed"`
	PolicyID string `json:"policyId"`
	Reason   string `json:"reason"`
}

type SentinelClient interface {
	Check(ctx context.Context, req SentinelRequest) (SentinelDecision, error)
}

type SentinelRequest struct {
	AgentID string
	Pool    string
	Delta   int
}

type StaticSentinel struct {
	DeniedPools map[string]struct{}
	MaxDelta    int
}

func NewStaticSentinel(denied []string, maxDelta int) *StaticSentinel {
	set := make(map[string]struct{})
	for _, p := range denied {
		set[strings.ToLower(p)] = struct{}{}
	}
	return &StaticSentinel{
		DeniedPools: set,
		MaxDelta:    maxDelta,
	}
}

func (s *StaticSentinel) Check(ctx context.Context, req SentinelRequest) (SentinelDecision, error) {
	if _, ok := s.DeniedPools[strings.ToLower(req.Pool)]; ok {
		return SentinelDecision{
			Allowed:  false,
			PolicyID: "sentinel-deny-pool",
			Reason:   "pool blocked by policy",
		}, nil
	}
	if s.MaxDelta > 0 && req.Delta > s.MaxDelta {
		return SentinelDecision{
			Allowed:  false,
			PolicyID: "sentinel-max-delta",
			Reason:   "delta exceeds policy limit",
		}, nil
	}
	return SentinelDecision{
		Allowed:  true,
		PolicyID: "sentinel-allow",
		Reason:   "approved",
	}, nil
}

func MarshalDecision(decision SentinelDecision) json.RawMessage {
	b, _ := json.Marshal(decision)
	return b
}
