package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
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

// GetOrderedCausalTrace returns a topologically ordered causal path for the given trace ID (node ID).
// It traverses ancestors (causes) and returns them in causal order (causes before effects).
func (s *Service) GetOrderedCausalTrace(ctx context.Context, id uuid.UUID) (models.OrderedTraceResult, error) {
	// 1. Fetch all ancestors (transitive closure of 'incoming' edges)
	// We use BFS to collect the subgraph.
	nodes := make(map[uuid.UUID]models.ReasonNode)
	edges := make(map[uuid.UUID]models.ReasonEdge)
	visited := make(map[uuid.UUID]bool)
	queue := []uuid.UUID{id}
	visited[id] = true

	// Limit depth/size to prevent infinite loops or OOM on massive graphs
	// For now, hardcoded limit or use config
	maxNodes := 1000
	cycleDetected := false
	cycleDetails := []string{}

	for len(queue) > 0 {
		if len(nodes) > maxNodes {
			break
		}
		currID := queue[0]
		queue = queue[1:]

		node, err := s.store.GetNode(ctx, currID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				continue // skip missing nodes in graph (shouldn't happen with FKs)
			}
			return models.OrderedTraceResult{}, err
		}
		nodes[currID] = node

		// Get incoming edges (causes)
		incoming, err := s.store.ListEdgesTo(ctx, currID)
		if err != nil {
			return models.OrderedTraceResult{}, err
		}

		for _, e := range incoming {
			edges[e.ID] = e
			if !visited[e.From] {
				visited[e.From] = true
				queue = append(queue, e.From)
			}
		}
	}

	// 2. Fetch Annotations for all collected nodes and edges
	targetIDs := make([]uuid.UUID, 0, len(nodes)+len(edges))
	for id := range nodes {
		targetIDs = append(targetIDs, id)
	}
	for id := range edges {
		targetIDs = append(targetIDs, id)
	}

	annotations, err := s.store.ListAnnotations(ctx, targetIDs)
	if err != nil {
		return models.OrderedTraceResult{}, fmt.Errorf("list annotations: %w", err)
	}

	annMap := make(map[uuid.UUID][]models.ReasonAnnotation)
	for _, ann := range annotations {
		annMap[ann.TargetID] = append(annMap[ann.TargetID], ann)
	}

	// 3. Topological Sort (Kahn's Algorithm)
	// Build adjacency list for the subgraph induced by collected nodes and edges.
	// We want "parents before children". Since we traversed backwards (ancestors),
	// the edges are From -> To. So this is standard topo sort.

	// We also treat edges as items in the sorted list?
	// The requirement: "ordered_path: array of entries where each entry is { id, type: 'node' | 'edge' ... }"
	// "Parents before children" usually applies to nodes.
	// If A -> E -> B (A causes B via Edge E), then order: A, E, B.
	// So we can model the graph as: Node A -> Edge E -> Node B.
	// Thus:
	//   Edge E depends on Node A (From)
	//   Node B depends on Edge E (To)

	// Let's build a dependency graph where items are Nodes AND Edges.
	// Item IDs: Node IDs and Edge IDs.

	type itemRef struct {
		id   uuid.UUID
		kind string // "node" or "edge"
	}

	topoAdj := make(map[uuid.UUID][]uuid.UUID)
	topoInDegree := make(map[uuid.UUID]int)

	// Initialize for nodes
	for id := range nodes {
		topoInDegree[id] = 0
	}
	// Initialize for edges
	for id := range edges {
		topoInDegree[id] = 0
	}

	for _, e := range edges {
		// A -> Edge -> B
		// Edge depends on FromNode (A)
		// ToNode (B) depends on Edge

		// A -> Edge
		topoAdj[e.From] = append(topoAdj[e.From], e.ID)
		topoInDegree[e.ID]++

		// Edge -> B
		topoAdj[e.ID] = append(topoAdj[e.ID], e.To)
		topoInDegree[e.To]++
	}

	// Priority Queue for deterministic tie-breaking?
	// Kahn's algorithm with a Priority Queue (or just sorting the available set)
	// Tie-break: timestamp then UUID.

	// Items with in-degree 0
	zeroIn := []uuid.UUID{}
	for id, deg := range topoInDegree {
		if deg == 0 {
			zeroIn = append(zeroIn, id)
		}
	}

	sortKeys := func(ids []uuid.UUID) {
		sort.Slice(ids, func(i, j int) bool {
			// Get timestamp
			var tsI, tsJ time.Time
			if n, ok := nodes[ids[i]]; ok {
				tsI = n.CreatedAt
			} else if e, ok := edges[ids[i]]; ok {
				tsI = e.CreatedAt
			}
			if n, ok := nodes[ids[j]]; ok {
				tsJ = n.CreatedAt
			} else if e, ok := edges[ids[j]]; ok {
				tsJ = e.CreatedAt
			}

			if !tsI.Equal(tsJ) {
				return tsI.Before(tsJ)
			}
			return ids[i].String() < ids[j].String()
		})
	}

	sortKeys(zeroIn)

	orderedPath := []models.OrderedTraceEntry{}
	processedCount := 0
	totalItems := len(nodes) + len(edges)

	for len(zeroIn) > 0 {
		currID := zeroIn[0]
		zeroIn = zeroIn[1:]
		processedCount++

		// Add to result
		var entry models.OrderedTraceEntry
		if n, ok := nodes[currID]; ok {
			entry = models.OrderedTraceEntry{
				ID:          n.ID,
				Type:        "node",
				EntityType:  n.Type,
				Timestamp:   n.CreatedAt,
				Annotations: annMap[n.ID],
				Payload:     n.Payload,
			}
			if n.AuditEventID != nil {
				entry.AuditRef = &models.AuditRef{EventID: *n.AuditEventID}
			}
			// Parents for a node are the incoming edges
			// But in our "A->E->B" model, the parent of B is E.
			// Let's stick to the graph structure for parent_ids.
			// The prompt says "parent_ids" which usually means immediate causal predecessors.
			// For B, parent is A (via E). Or is it E?
			// "parent_ids" usually refers to nodes.
			// If type is "node", parent_ids = IDs of nodes that have edges pointing to this node.
			// If type is "edge", parent_ids = ID of the From node.

			if entry.Type == "node" {
				parents := []uuid.UUID{}
				// Find edges pointing to this node
				// We can iterate edges (inefficient but safe for small graphs) or build reverse map
				for _, e := range edges {
					if e.To == n.ID {
						parents = append(parents, e.From) // Node parent
					}
				}
				// Sort parents for determinism
				sort.Slice(parents, func(i, j int) bool { return parents[i].String() < parents[j].String() })
				entry.ParentIDs = parents
			}
		} else if e, ok := edges[currID]; ok {
			entry = models.OrderedTraceEntry{
				ID:          e.ID,
				Type:        "edge",
				EntityType:  e.Type,
				Timestamp:   e.CreatedAt,
				Annotations: annMap[e.ID],
				From:        &e.From,
				To:          &e.To,
			}
			if e.AuditEventID != nil {
				entry.AuditRef = &models.AuditRef{EventID: *e.AuditEventID}
			}
			entry.ParentIDs = []uuid.UUID{e.From}
		}

		entry.CausalIndex = len(orderedPath)
		orderedPath = append(orderedPath, entry)

		// Update neighbors
		neighbors := topoAdj[currID]
		// Sort neighbors to ensure we process them in deterministic order if they become 0-degree at same time
		// (Actually strictly not needed if we sort zeroIn every insertion, but good practice)

		for _, neighbor := range neighbors {
			topoInDegree[neighbor]--
			if topoInDegree[neighbor] == 0 {
				zeroIn = append(zeroIn, neighbor)
			}
		}
		// Re-sort zeroIn to maintain priority queue invariant
		sortKeys(zeroIn)
	}

	// Cycle Detection
	if processedCount < totalItems {
		cycleDetected = true
		// Find items that were not processed (still have in-degree > 0)
		remaining := []string{}
		for id, deg := range topoInDegree {
			if deg > 0 {
				remaining = append(remaining, id.String())

				// Force add them to the path using deterministic tie break (timestamp) to allow consumers to see them
				// The prompt says: "still return a deterministic acyclic reduction ... include details of cycle detection"
				// "Break cycles deterministically (e.g., by earliest timestamp...)"

				// We can just dump the remaining items sorted by timestamp
			}
		}
		cycleDetails = remaining

		// Add remaining items sorted by timestamp
		remainingIDs := []uuid.UUID{}
		for id, deg := range topoInDegree {
			if deg > 0 {
				remainingIDs = append(remainingIDs, id)
			}
		}
		sortKeys(remainingIDs)

		for _, id := range remainingIDs {
			var entry models.OrderedTraceEntry
			if n, ok := nodes[id]; ok {
				entry = models.OrderedTraceEntry{
					ID:          n.ID,
					Type:        "node",
					EntityType:  n.Type,
					Timestamp:   n.CreatedAt,
					Annotations: annMap[n.ID],
					Payload:     n.Payload,
				}
				if n.AuditEventID != nil {
					entry.AuditRef = &models.AuditRef{EventID: *n.AuditEventID}
				}
				// Parents logic
				parents := []uuid.UUID{}
				for _, e := range edges {
					if e.To == n.ID {
						parents = append(parents, e.From)
					}
				}
				sort.Slice(parents, func(i, j int) bool { return parents[i].String() < parents[j].String() })
				entry.ParentIDs = parents

			} else if e, ok := edges[id]; ok {
				entry = models.OrderedTraceEntry{
					ID:          e.ID,
					Type:        "edge",
					EntityType:  e.Type,
					Timestamp:   e.CreatedAt,
					Annotations: annMap[e.ID],
					From:        &e.From,
					To:          &e.To,
				}
				if e.AuditEventID != nil {
					entry.AuditRef = &models.AuditRef{EventID: *e.AuditEventID}
				}
				entry.ParentIDs = []uuid.UUID{e.From}
			}

			entry.CausalIndex = len(orderedPath)
			orderedPath = append(orderedPath, entry)
		}
	}

	return models.OrderedTraceResult{
		TraceID:     id,
		OrderedPath: orderedPath,
		Metadata: models.OrderedTraceMetadata{
			TraceID:       id,
			CreatedAt:     time.Now().UTC(),
			Length:        len(orderedPath),
			CycleDetected: cycleDetected,
			CycleDetails:  strings.Join(cycleDetails, ","),
		},
	}, nil
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
