package sentinel

import (
	"context"
	"encoding/json"
	"errors"
)

type Decision struct {
	Allowed  bool   `json:"allowed"`
	PolicyID string `json:"policyId"`
	Reason   string `json:"reason"`
}

type Request struct {
	ArtifactID  string
	Environment string
	Evaluation  map[string]float64
}

type Client interface {
	Check(ctx context.Context, req Request) (Decision, error)
}

type StaticClient struct {
	MinScore float64
}

func NewStaticClient(minScore float64) *StaticClient {
	return &StaticClient{MinScore: minScore}
}

func (c *StaticClient) Check(ctx context.Context, req Request) (Decision, error) {
	score := req.Evaluation["quality"]
	if score < c.MinScore {
		return Decision{
			Allowed:  false,
			PolicyID: "sentinel-low-quality",
			Reason:   "quality score below threshold",
		}, nil
	}
	return Decision{
		Allowed:  true,
		PolicyID: "sentinel-allow",
		Reason:   "meets threshold",
	}, nil
}

func MarshalDecision(decision Decision) json.RawMessage {
	b, _ := json.Marshal(decision)
	return b
}

var ErrDenied = errors.New("sentinel denied")
