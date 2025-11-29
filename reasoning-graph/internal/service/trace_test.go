package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

// MockStore
type MockStore struct {
	mock.Mock
}

func (m *MockStore) CreateNode(ctx context.Context, in store.NodeInput) (models.ReasonNode, error) {
	args := m.Called(ctx, in)
	return args.Get(0).(models.ReasonNode), args.Error(1)
}
func (m *MockStore) GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error) {
	args := m.Called(ctx, id)
	return args.Get(0).(models.ReasonNode), args.Error(1)
}
func (m *MockStore) CreateEdge(ctx context.Context, in store.EdgeInput) (models.ReasonEdge, error) {
	args := m.Called(ctx, in)
	return args.Get(0).(models.ReasonEdge), args.Error(1)
}
func (m *MockStore) ListEdgesFrom(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	args := m.Called(ctx, nodeID)
	return args.Get(0).([]models.ReasonEdge), args.Error(1)
}
func (m *MockStore) ListEdgesTo(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	args := m.Called(ctx, nodeID)
	return args.Get(0).([]models.ReasonEdge), args.Error(1)
}
func (m *MockStore) CreateSnapshot(ctx context.Context, in store.SnapshotInput) (models.ReasonSnapshot, error) {
	args := m.Called(ctx, in)
	return args.Get(0).(models.ReasonSnapshot), args.Error(1)
}
func (m *MockStore) GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error) {
	args := m.Called(ctx, id)
	return args.Get(0).(models.ReasonSnapshot), args.Error(1)
}
func (m *MockStore) ListAnnotations(ctx context.Context, targetIDs []uuid.UUID) ([]models.ReasonAnnotation, error) {
	args := m.Called(ctx, targetIDs)
	return args.Get(0).([]models.ReasonAnnotation), args.Error(1)
}
func (m *MockStore) Ping(ctx context.Context) error {
	return nil
}

// MockSigner
type MockSigner struct{}

func (m *MockSigner) Sign(ctx context.Context, data []byte) ([]byte, error) {
	return []byte("signature"), nil
}
func (m *MockSigner) SignerID() string {
	return "mock-signer"
}

func TestGetOrderedCausalTrace_Linear(t *testing.T) {
	storeMock := new(MockStore)
	svc := New(storeMock, &MockSigner{}, Config{})
	ctx := context.Background()

	// A -> B -> C
	nodeA := models.ReasonNode{ID: uuid.New(), Type: "decision", CreatedAt: time.Now().Add(-3 * time.Hour)}
	nodeB := models.ReasonNode{ID: uuid.New(), Type: "decision", CreatedAt: time.Now().Add(-2 * time.Hour)}
	nodeC := models.ReasonNode{ID: uuid.New(), Type: "decision", CreatedAt: time.Now().Add(-1 * time.Hour)}

	edgeAB := models.ReasonEdge{ID: uuid.New(), From: nodeA.ID, To: nodeB.ID, Type: "causal", CreatedAt: time.Now().Add(-2 * time.Hour)}
	edgeBC := models.ReasonEdge{ID: uuid.New(), From: nodeB.ID, To: nodeC.ID, Type: "causal", CreatedAt: time.Now().Add(-1 * time.Hour)}

	// Setup Mocks
	storeMock.On("GetNode", ctx, nodeC.ID).Return(nodeC, nil)
	storeMock.On("GetNode", ctx, nodeB.ID).Return(nodeB, nil)
	storeMock.On("GetNode", ctx, nodeA.ID).Return(nodeA, nil)

	storeMock.On("ListEdgesTo", ctx, nodeC.ID).Return([]models.ReasonEdge{edgeBC}, nil)
	storeMock.On("ListEdgesTo", ctx, nodeB.ID).Return([]models.ReasonEdge{edgeAB}, nil)
	storeMock.On("ListEdgesTo", ctx, nodeA.ID).Return([]models.ReasonEdge{}, nil)

	// Annotations
	annA := models.ReasonAnnotation{ID: uuid.New(), TargetID: nodeA.ID, TargetType: "node", CreatedAt: time.Now()}
	storeMock.On("ListAnnotations", ctx, mock.MatchedBy(func(ids []uuid.UUID) bool {
		// Just check length or presence roughly
		return len(ids) > 0
	})).Return([]models.ReasonAnnotation{annA}, nil)

	// Execute
	result, err := svc.GetOrderedCausalTrace(ctx, nodeC.ID)
	assert.NoError(t, err)

	// Verify
	assert.Equal(t, nodeC.ID, result.TraceID)
	assert.False(t, result.Metadata.CycleDetected)

	// Expected Order: A, AB, B, BC, C
	assert.Len(t, result.OrderedPath, 5)
	assert.Equal(t, nodeA.ID, result.OrderedPath[0].ID)
	assert.Len(t, result.OrderedPath[0].Annotations, 1) // Check annotation
	assert.Equal(t, edgeAB.ID, result.OrderedPath[1].ID)
	assert.Equal(t, nodeB.ID, result.OrderedPath[2].ID)
	assert.Equal(t, edgeBC.ID, result.OrderedPath[3].ID)
	assert.Equal(t, nodeC.ID, result.OrderedPath[4].ID)
}

func TestGetOrderedCausalTrace_Cycle(t *testing.T) {
	storeMock := new(MockStore)
	svc := New(storeMock, &MockSigner{}, Config{})
	ctx := context.Background()

	// A -> B -> A (Cycle)
	nodeA := models.ReasonNode{ID: uuid.New(), Type: "decision", CreatedAt: time.Now().Add(-2 * time.Hour)}
	nodeB := models.ReasonNode{ID: uuid.New(), Type: "decision", CreatedAt: time.Now().Add(-1 * time.Hour)}

	edgeAB := models.ReasonEdge{ID: uuid.New(), From: nodeA.ID, To: nodeB.ID, Type: "causal", CreatedAt: time.Now().Add(-2 * time.Hour)}
	edgeBA := models.ReasonEdge{ID: uuid.New(), From: nodeB.ID, To: nodeA.ID, Type: "causal", CreatedAt: time.Now().Add(-1 * time.Hour)}

	// Setup Mocks
	storeMock.On("GetNode", ctx, nodeB.ID).Return(nodeB, nil)
	storeMock.On("GetNode", ctx, nodeA.ID).Return(nodeA, nil)

	storeMock.On("ListEdgesTo", ctx, nodeB.ID).Return([]models.ReasonEdge{edgeAB}, nil)
	storeMock.On("ListEdgesTo", ctx, nodeA.ID).Return([]models.ReasonEdge{edgeBA}, nil)

	storeMock.On("ListAnnotations", ctx, mock.Anything).Return([]models.ReasonAnnotation{}, nil)

	// Execute
	result, err := svc.GetOrderedCausalTrace(ctx, nodeB.ID)
	assert.NoError(t, err)

	// Verify
	assert.True(t, result.Metadata.CycleDetected)
	// Even with cycle, we should get all items
	assert.Len(t, result.OrderedPath, 4) // A, B, AB, BA
}

func TestGetOrderedCausalTrace_Branching(t *testing.T) {
	storeMock := new(MockStore)
	svc := New(storeMock, &MockSigner{}, Config{})
	ctx := context.Background()

	// A -> B
	// A -> C
	// B -> D
	// C -> D
	// Request D. Ancestors: B, C, A.
	// Order: A, (AB, AC), B, C, (BD, CD), D

	id := func(s string) uuid.UUID { u := uuid.New(); return u }

	nA := models.ReasonNode{ID: id("A"), Type: "n", CreatedAt: time.Now().Add(-10 * time.Hour)}
	nB := models.ReasonNode{ID: id("B"), Type: "n", CreatedAt: time.Now().Add(-8 * time.Hour)}
	nC := models.ReasonNode{ID: id("C"), Type: "n", CreatedAt: time.Now().Add(-8 * time.Hour)}
	nD := models.ReasonNode{ID: id("D"), Type: "n", CreatedAt: time.Now().Add(-6 * time.Hour)}

	eAB := models.ReasonEdge{ID: id("AB"), From: nA.ID, To: nB.ID, Type: "e", CreatedAt: time.Now().Add(-9 * time.Hour)}
	eAC := models.ReasonEdge{ID: id("AC"), From: nA.ID, To: nC.ID, Type: "e", CreatedAt: time.Now().Add(-9 * time.Hour)}
	eBD := models.ReasonEdge{ID: id("BD"), From: nB.ID, To: nD.ID, Type: "e", CreatedAt: time.Now().Add(-7 * time.Hour)}
	eCD := models.ReasonEdge{ID: id("CD"), From: nC.ID, To: nD.ID, Type: "e", CreatedAt: time.Now().Add(-7 * time.Hour)}

	storeMock.On("GetNode", ctx, nD.ID).Return(nD, nil)
	storeMock.On("GetNode", ctx, nC.ID).Return(nC, nil)
	storeMock.On("GetNode", ctx, nB.ID).Return(nB, nil)
	storeMock.On("GetNode", ctx, nA.ID).Return(nA, nil)

	storeMock.On("ListEdgesTo", ctx, nD.ID).Return([]models.ReasonEdge{eBD, eCD}, nil)
	storeMock.On("ListEdgesTo", ctx, nC.ID).Return([]models.ReasonEdge{eAC}, nil)
	storeMock.On("ListEdgesTo", ctx, nB.ID).Return([]models.ReasonEdge{eAB}, nil)
	storeMock.On("ListEdgesTo", ctx, nA.ID).Return([]models.ReasonEdge{}, nil)

	storeMock.On("ListAnnotations", ctx, mock.Anything).Return([]models.ReasonAnnotation{}, nil)

	result, err := svc.GetOrderedCausalTrace(ctx, nD.ID)
	assert.NoError(t, err)

	assert.False(t, result.Metadata.CycleDetected)
	assert.Len(t, result.OrderedPath, 8) // 4 nodes, 4 edges

	// Check topological order constraints
	pos := make(map[uuid.UUID]int)
	for i, entry := range result.OrderedPath {
		pos[entry.ID] = i
	}

	assert.True(t, pos[nA.ID] < pos[eAB.ID])
	assert.True(t, pos[eAB.ID] < pos[nB.ID])
	assert.True(t, pos[nB.ID] < pos[eBD.ID])
	assert.True(t, pos[eBD.ID] < pos[nD.ID])

	assert.True(t, pos[nA.ID] < pos[eAC.ID])
	assert.True(t, pos[eAC.ID] < pos[nC.ID])
	assert.True(t, pos[nC.ID] < pos[eCD.ID])
	assert.True(t, pos[eCD.ID] < pos[nD.ID])
}
