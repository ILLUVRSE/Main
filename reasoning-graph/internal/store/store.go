package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
)

var (
	ErrNotFound = errors.New("record not found")
)

// Store represents the persistence contract for the Reasoning Graph.
type Store interface {
	CreateNode(ctx context.Context, in NodeInput) (models.ReasonNode, error)
	GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error)
	CreateEdge(ctx context.Context, in EdgeInput) (models.ReasonEdge, error)
	ListEdgesFrom(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error)
	ListEdgesTo(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error)
	CreateSnapshot(ctx context.Context, in SnapshotInput) (models.ReasonSnapshot, error)
	GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error)
	ListAnnotations(ctx context.Context, targetIDs []uuid.UUID) ([]models.ReasonAnnotation, error)
	Ping(ctx context.Context) error
}

type PGStore struct {
	db *sql.DB
}

func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

type NodeInput struct {
	ID                  uuid.UUID
	Type                string
	Payload             json.RawMessage
	Author              string
	Version             *string
	ManifestSignatureID *string
	AuditEventID        *string
	Metadata            json.RawMessage
}

type EdgeInput struct {
	ID           uuid.UUID
	From         uuid.UUID
	To           uuid.UUID
	Type         string
	Weight       *float64
	Metadata     json.RawMessage
	AuditEventID *string
}

type SnapshotInput struct {
	ID          uuid.UUID
	RootNodeIDs []uuid.UUID
	Description *string
	Hash        string
	Signature   string
	SignerID    string
	Snapshot    json.RawMessage
}

func ensureJSON(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(fallback)
	}
	return raw
}

func (s *PGStore) CreateNode(ctx context.Context, in NodeInput) (models.ReasonNode, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	payload := ensureJSON(in.Payload, "{}")
	metadata := ensureJSON(in.Metadata, "{}")

	query := `
		INSERT INTO reason_nodes (id, type, payload, author, version, manifest_signature_id, audit_event_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at
	`

	var createdAt time.Time
	if err := s.db.QueryRowContext(
		ctx,
		query,
		in.ID,
		in.Type,
		payload,
		in.Author,
		in.Version,
		in.ManifestSignatureID,
		in.AuditEventID,
		metadata,
	).Scan(&createdAt); err != nil {
		return models.ReasonNode{}, fmt.Errorf("insert node: %w", err)
	}

	return models.ReasonNode{
		ID:                  in.ID,
		Type:                in.Type,
		Payload:             payload,
		Author:              in.Author,
		Version:             in.Version,
		ManifestSignatureID: in.ManifestSignatureID,
		AuditEventID:        in.AuditEventID,
		Metadata:            metadata,
		CreatedAt:           createdAt,
	}, nil
}

func (s *PGStore) GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error) {
	const query = `
		SELECT id, type, payload, author, version, manifest_signature_id, audit_event_id, metadata, created_at
		FROM reason_nodes
		WHERE id = $1
	`

	var (
		node                models.ReasonNode
		payload, metadata   []byte
		version, manifestID sql.NullString
		auditEventID        sql.NullString
	)

	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&node.ID,
		&node.Type,
		&payload,
		&node.Author,
		&version,
		&manifestID,
		&auditEventID,
		&metadata,
		&node.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ReasonNode{}, ErrNotFound
		}
		return models.ReasonNode{}, fmt.Errorf("select node: %w", err)
	}

	node.Payload = append(json.RawMessage(nil), payload...)
	node.Metadata = append(json.RawMessage(nil), metadata...)
	if version.Valid {
		node.Version = &version.String
	}
	if manifestID.Valid {
		node.ManifestSignatureID = &manifestID.String
	}
	if auditEventID.Valid {
		node.AuditEventID = &auditEventID.String
	}
	return node, nil
}

func (s *PGStore) CreateEdge(ctx context.Context, in EdgeInput) (models.ReasonEdge, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	metadata := ensureJSON(in.Metadata, "{}")

	query := `
		INSERT INTO reason_edges (id, from_node, to_node, type, weight, metadata, audit_event_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at
	`

	var createdAt time.Time
	if err := s.db.QueryRowContext(
		ctx,
		query,
		in.ID,
		in.From,
		in.To,
		in.Type,
		in.Weight,
		metadata,
		in.AuditEventID,
	).Scan(&createdAt); err != nil {
		return models.ReasonEdge{}, fmt.Errorf("insert edge: %w", err)
	}

	return models.ReasonEdge{
		ID:           in.ID,
		From:         in.From,
		To:           in.To,
		Type:         in.Type,
		Weight:       in.Weight,
		Metadata:     metadata,
		AuditEventID: in.AuditEventID,
		CreatedAt:    createdAt,
	}, nil
}

func (s *PGStore) listEdges(ctx context.Context, query string, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	rows, err := s.db.QueryContext(ctx, query, nodeID)
	if err != nil {
		return nil, fmt.Errorf("query edges: %w", err)
	}
	defer rows.Close()

	var edges []models.ReasonEdge
	for rows.Next() {
		var (
			edge         models.ReasonEdge
			metadata     []byte
			weight       sql.NullFloat64
			auditEventID sql.NullString
		)
		if err := rows.Scan(
			&edge.ID,
			&edge.From,
			&edge.To,
			&edge.Type,
			&weight,
			&metadata,
			&auditEventID,
			&edge.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan edge: %w", err)
		}
		if weight.Valid {
			v := weight.Float64
			edge.Weight = &v
		}
		edge.Metadata = append(json.RawMessage(nil), metadata...)
		if auditEventID.Valid {
			edge.AuditEventID = &auditEventID.String
		}
		edges = append(edges, edge)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("edges rows err: %w", err)
	}
	return edges, nil
}

func (s *PGStore) ListEdgesFrom(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	const query = `
		SELECT id, from_node, to_node, type, weight, metadata, audit_event_id, created_at
		FROM reason_edges
		WHERE from_node = $1
		ORDER BY created_at ASC
	`
	return s.listEdges(ctx, query, nodeID)
}

func (s *PGStore) ListEdgesTo(ctx context.Context, nodeID uuid.UUID) ([]models.ReasonEdge, error) {
	const query = `
		SELECT id, from_node, to_node, type, weight, metadata, audit_event_id, created_at
		FROM reason_edges
		WHERE to_node = $1
		ORDER BY created_at ASC
	`
	return s.listEdges(ctx, query, nodeID)
}

func (s *PGStore) ListAnnotations(ctx context.Context, targetIDs []uuid.UUID) ([]models.ReasonAnnotation, error) {
	if len(targetIDs) == 0 {
		return []models.ReasonAnnotation{}, nil
	}
	const query = `
		SELECT id, target_id, target_type, annotation_type, payload, audit_event_id, created_at
		FROM reason_annotations
		WHERE target_id = ANY($1)
		ORDER BY created_at ASC
	`
	rows, err := s.db.QueryContext(ctx, query, pq.Array(targetIDs))
	if err != nil {
		return nil, fmt.Errorf("query annotations: %w", err)
	}
	defer rows.Close()

	var anns []models.ReasonAnnotation
	for rows.Next() {
		var (
			ann          models.ReasonAnnotation
			payload      []byte
			auditEventID sql.NullString
		)
		if err := rows.Scan(
			&ann.ID,
			&ann.TargetID,
			&ann.TargetType,
			&ann.AnnotationType,
			&payload,
			&auditEventID,
			&ann.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan annotation: %w", err)
		}
		ann.Payload = append(json.RawMessage(nil), payload...)
		if auditEventID.Valid {
			ann.AuditEventID = &auditEventID.String
		}
		anns = append(anns, ann)
	}
	return anns, nil
}

func (s *PGStore) CreateSnapshot(ctx context.Context, in SnapshotInput) (models.ReasonSnapshot, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO reason_snapshots (id, root_node_ids, description, hash, signature, signer_id, snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at
	`

	var createdAt time.Time
	if err := s.db.QueryRowContext(
		ctx,
		query,
		in.ID,
		pq.Array(in.RootNodeIDs),
		in.Description,
		in.Hash,
		in.Signature,
		in.SignerID,
		ensureJSON(in.Snapshot, "{}"),
	).Scan(&createdAt); err != nil {
		return models.ReasonSnapshot{}, fmt.Errorf("insert snapshot: %w", err)
	}

	return models.ReasonSnapshot{
		ID:          in.ID,
		RootNodeIDs: append([]uuid.UUID(nil), in.RootNodeIDs...),
		Description: in.Description,
		Hash:        in.Hash,
		Signature:   in.Signature,
		SignerID:    in.SignerID,
		Snapshot:    ensureJSON(in.Snapshot, "{}"),
		CreatedAt:   createdAt,
	}, nil
}

func (s *PGStore) GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error) {
	const query = `
		SELECT id, root_node_ids, description, hash, signature, signer_id, snapshot, created_at
		FROM reason_snapshots
		WHERE id = $1
	`
	var (
		out         models.ReasonSnapshot
		rootNodeIDs []uuid.UUID
		description sql.NullString
		snapshot    []byte
	)
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&out.ID,
		pq.Array(&rootNodeIDs),
		&description,
		&out.Hash,
		&out.Signature,
		&out.SignerID,
		&snapshot,
		&out.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ReasonSnapshot{}, ErrNotFound
		}
		return models.ReasonSnapshot{}, fmt.Errorf("select snapshot: %w", err)
	}
	if description.Valid {
		out.Description = &description.String
	}
	out.RootNodeIDs = append([]uuid.UUID(nil), rootNodeIDs...)
	out.Snapshot = append(json.RawMessage(nil), snapshot...)
	return out, nil
}

func (s *PGStore) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	return nil
}
