package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/config"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/httpserver"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/service"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/signing"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load: %v", err)
	}

	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	reasonStore := store.NewPGStore(db)
	signer, err := signing.NewEd25519SignerFromB64(cfg.SignerKeyB64, cfg.SignerID)
	if err != nil {
		log.Fatalf("signer init: %v", err)
	}
	svc := service.New(reasonStore, signer, service.Config{
		MaxTraceDepth:    cfg.MaxTraceDepth,
		SnapshotDepth:    cfg.SnapshotDepth,
		MaxSnapshotRoots: cfg.MaxSnapshotRoots,
	})

	server := httpserver.New(cfg, reasonStore, svc)
	httpServer := &http.Server{
		Addr:    cfg.Addr,
		Handler: server.Router(),
	}

	go func() {
		log.Printf("Reasoning Graph service listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	shutdown(httpServer)
}

func shutdown(s *http.Server) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := s.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
