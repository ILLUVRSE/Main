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

	"github.com/ILLUVRSE/Main/eval-engine/internal/allocator"
	allochttp "github.com/ILLUVRSE/Main/eval-engine/internal/allocator/httpserver"
	"github.com/ILLUVRSE/Main/eval-engine/internal/config"
	"github.com/ILLUVRSE/Main/eval-engine/internal/store"
)

func main() {
	cfg, err := config.LoadAllocator()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}

	st := store.NewPGStore(db)
	pools := make([]allocator.Pool, 0, len(cfg.Pools))
	for _, p := range cfg.Pools {
		pools = append(pools, allocator.Pool{Name: p.Name, Capacity: p.Capacity})
	}
	sentinel := allocator.NewStaticSentinel(cfg.SentinelDeniedPools, cfg.SentinelMaxDelta)
	service := allocator.New(st, sentinel, pools)
	server := allochttp.New(service)

	httpServer := &http.Server{
		Addr:    cfg.Addr,
		Handler: server.Router(),
	}

	go func() {
		log.Printf("Resource Allocator listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("allocator server error: %v", err)
		}
	}()

	waitForShutdown(httpServer)
}

func waitForShutdown(srv *http.Server) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("allocator graceful shutdown: %v", err)
	}
}
