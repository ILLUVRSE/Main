package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

var (
	ErrInvalidTraceDirection = errors.New("invalid trace direction")
	ErrEmptySnapshotRoots    = errors.New("at least one root node id is required")
	ErrTooManySnapshotRoots  = errors.New("too many root node ids")
)

type Service struct {
	store            store.Store
	signer           signing.Signer
	maxTraceDepth    int
	snapshotDepth    int
	maxSnapshotRoots int
}

type Config struct {
	MaxTraceDepth    int
	SnapshotDepth    int
	MaxSnapshotRoots int
}

func New(store store.Store, signer signing.Signer, cfg Config) *Service {
	return &Service{
		store:            store,
		signer:           signer,
		maxTraceDepth:    cfg.MaxTraceDepth,
		snapshotDepth:    cfg.SnapshotDepth,
		maxSnapshotRoots: cfg.MaxSnapshotRoots,
	}
}

func (s *Service) clampTraceDepth(depth int) int {
	if depth <= 0 {
		depth = 1
	}
	if s.maxTraceDepth > 0 && depth > s.maxTraceDepth {
		return s.maxTraceDepth
	}
	return depth
}

type SnapshotRequest struct {
	RootNodeIDs []uuid.UUID
	Description *string
}

func (s *Service) ComputeTrace(ctx context.Context, start uuid.UUID, direction models.TraceDirection, depth int) (models.TraceResult, error) {
	if direction != models.TraceDirectionAncestors && direction != models.TraceDirectionDescendants {
		return models.TraceResult{}, ErrInvalidTraceDirection
	}
	depth = s.clampTraceDepth(depth)
	type queueItem struct {
		id    uuid.UUID
		depth int
	}

	visited := map[uuid.UUID]bool{}
	nodeCache := map[uuid.UUID]models.ReasonNode{}
	queue := []queueItem{{id: start, depth: 0}}
	visited[start] = true

	result := models.TraceResult{
		StartNodeID: start,
		Direction:   direction,
		Depth:       depth,
		GeneratedAt: time.Now().UTC(),
	}

	edgeSet := map[uuid.UUID]models.ReasonEdge{}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		node, err := s.getNode(ctx, nodeCache, item.id)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return models.TraceResult{}, err
			}
			return models.TraceResult{}, err
		}

		incoming, err := s.store.ListEdgesTo(ctx, node.ID)
		if err != nil {
			return models.TraceResult{}, err
		}
		outgoing, err := s.store.ListEdgesFrom(ctx, node.ID)
		if err != nil {
			return models.TraceResult{}, err
		}

		for _, e := range incoming {
			edgeSet[e.ID] = e
		}
		for _, e := range outgoing {
			edgeSet[e.ID] = e
		}

		cycle := false
		if item.depth < depth {
			switch direction {
			case models.TraceDirectionAncestors:
				for _, e := range incoming {
					nextID := e.From
					if visited[nextID] {
						cycle = true
						continue
					}
					visited[nextID] = true
					queue = append(queue, queueItem{id: nextID, depth: item.depth + 1})
				}
			case models.TraceDirectionDescendants:
				for _, e := range outgoing {
					nextID := e.To
					if visited[nextID] {
						cycle = true
						continue
					}
					visited[nextID] = true
					queue = append(queue, queueItem{id: nextID, depth: item.depth + 1})
				}
			}
		}

		result.Steps = append(result.Steps, models.TraceStep{
			Node:          node,
			IncomingEdges: incoming,
			OutgoingEdges: outgoing,
			CycleDetected: cycle,
			Depth:         item.depth,
		})
	}

	for _, edge := range edgeSet {
		result.Edges = append(result.Edges, edge)
	}
	sort.Slice(result.Edges, func(i, j int) bool {
		return result.Edges[i].CreatedAt.Before(result.Edges[j].CreatedAt)
	})

	for id := range visited {
		result.Visited = append(result.Visited, id)
	}
	sort.Slice(result.Visited, func(i, j int) bool {
		return result.Visited[i].String() < result.Visited[j].String()
	})

	return result, nil
}

func (s *Service) getNode(ctx context.Context, cache map[uuid.UUID]models.ReasonNode, id uuid.UUID) (models.ReasonNode, error) {
	if node, ok := cache[id]; ok {
		return node, nil
	}
	node, err := s.store.GetNode(ctx, id)
	if err != nil {
		return models.ReasonNode{}, err
	}
	cache[id] = node
	return node, nil
}

func (s *Service) CreateSnapshot(ctx context.Context, req SnapshotRequest) (models.ReasonSnapshot, error) {
	if len(req.RootNodeIDs) == 0 {
		return models.ReasonSnapshot{}, ErrEmptySnapshotRoots
	}
	if s.maxSnapshotRoots > 0 && len(req.RootNodeIDs) > s.maxSnapshotRoots {
		return models.ReasonSnapshot{}, ErrTooManySnapshotRoots
	}
	nodes, edges, err := s.collectSubgraph(ctx, req.RootNodeIDs)
	if err != nil {
		return models.ReasonSnapshot{}, err
	}
	canonical, err := canonicalizeSnapshot(nodes, edges)
	if err != nil {
		return models.ReasonSnapshot{}, err
	}

	hash := sha256.Sum256(canonical)
	signatureBytes, err := s.signer.Sign(ctx, hash[:])
	if err != nil {
		return models.ReasonSnapshot{}, fmt.Errorf("sign snapshot hash: %w", err)
	}
	signature := base64.StdEncoding.EncodeToString(signatureBytes)

	input := store.SnapshotInput{
		RootNodeIDs: req.RootNodeIDs,
		Description: req.Description,
		Hash:        fmt.Sprintf("%x", hash[:]),
		Signature:   signature,
		SignerID:    s.signer.SignerID(),
		Snapshot:    canonical,
	}
	return s.store.CreateSnapshot(ctx, input)
}

func (s *Service) collectSubgraph(ctx context.Context, rootIDs []uuid.UUID) (map[uuid.UUID]models.ReasonNode, map[uuid.UUID]models.ReasonEdge, error) {
	type queueItem struct {
		id    uuid.UUID
		depth int
	}
	nodes := make(map[uuid.UUID]models.ReasonNode)
	edges := make(map[uuid.UUID]models.ReasonEdge)
	visited := make(map[uuid.UUID]bool)
	queue := make([]queueItem, 0, len(rootIDs))

	for _, id := range rootIDs {
		visited[id] = true
		queue = append(queue, queueItem{id: id, depth: 0})
	}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		node, err := s.store.GetNode(ctx, item.id)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return nil, nil, fmt.Errorf("root node %s not found", item.id)
			}
			return nil, nil, err
		}
		nodes[item.id] = node

		incoming, err := s.store.ListEdgesTo(ctx, item.id)
		if err != nil {
			return nil, nil, err
		}
		outgoing, err := s.store.ListEdgesFrom(ctx, item.id)
		if err != nil {
			return nil, nil, err
		}

		for _, e := range incoming {
			edges[e.ID] = e
			if item.depth < s.snapshotDepth && !visited[e.From] {
				visited[e.From] = true
				queue = append(queue, queueItem{id: e.From, depth: item.depth + 1})
			}
		}
		for _, e := range outgoing {
			edges[e.ID] = e
			if item.depth < s.snapshotDepth && !visited[e.To] {
				visited[e.To] = true
				queue = append(queue, queueItem{id: e.To, depth: item.depth + 1})
			}
		}
	}
	return nodes, edges, nil
}

func canonicalizeSnapshot(nodes map[uuid.UUID]models.ReasonNode, edges map[uuid.UUID]models.ReasonEdge) ([]byte, error) {
	nodeList := make([]models.ReasonNode, 0, len(nodes))
	for _, n := range nodes {
		nodeList = append(nodeList, n)
	}
	sort.Slice(nodeList, func(i, j int) bool {
		return nodeList[i].ID.String() < nodeList[j].ID.String()
	})

	edgeList := make([]models.ReasonEdge, 0, len(edges))
	for _, e := range edges {
		edgeList = append(edgeList, e)
	}
	sort.Slice(edgeList, func(i, j int) bool {
		return edgeList[i].ID.String() < edgeList[j].ID.String()
	})

	payload := struct {
		Nodes []models.ReasonNode `json:"nodes"`
		Edges []models.ReasonEdge `json:"edges"`
	}{
		Nodes: nodeList,
		Edges: edgeList,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot canonical json: %w", err)
	}
	return data, nil
}
