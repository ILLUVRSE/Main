package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/snapshot"
)

// MockStore implements snapshot.Store
type MockStore struct {
	LastSnapshot *snapshot.PersistedSnapshot
}

func (m *MockStore) SaveSnapshot(ctx context.Context, s *snapshot.PersistedSnapshot) error {
	m.LastSnapshot = s
	return nil
}

func main() {
	outFile := flag.String("out", "snapshot.json", "Output file path")
	signersPath := flag.String("signers", "signers.json", "Signers file path")
	flag.Parse()

	// 1. Setup Signer (Test Adapter)
	signer, err := signing.NewInMemorySigner(*signersPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating signer: %v\n", err)
		os.Exit(1)
	}

	// 2. Setup Service
	store := &MockStore{}
	svc := snapshot.NewService(signer, store)

	// 3. Create Snapshot
	ctx := context.Background()
	payload := map[string]interface{}{
		"nodes": []string{"node1", "node2"},
		"edges": []map[string]string{
			{"from": "node1", "to": "node2"},
		},
	}

	snap, err := svc.CreateSnapshotAndSign(ctx, "snap-123", []string{"node1"}, payload, "sig-456")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating snapshot: %v\n", err)
		os.Exit(1)
	}

	// 4. Write to file
	bytes, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling snapshot: %v\n", err)
		os.Exit(1)
	}

	if err := os.MkdirAll(filepath.Dir(*outFile), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating directory: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(*outFile, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing file: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Snapshot created successfully")
}
