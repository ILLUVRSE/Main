package main

import (
	"context"
	"database/sql"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/ILLUVRSE/Main/ai-infra/internal/config"
	"github.com/ILLUVRSE/Main/ai-infra/internal/httpserver"
	"github.com/ILLUVRSE/Main/ai-infra/internal/runner"
	"github.com/ILLUVRSE/Main/ai-infra/internal/sentinel"
	"github.com/ILLUVRSE/Main/ai-infra/internal/service"
	"github.com/ILLUVRSE/Main/ai-infra/internal/signing"
	"github.com/ILLUVRSE/Main/ai-infra/internal/store"
)

func enforceProdGuardrails() {
	nodeEnv := os.Getenv("NODE_ENV")
	if nodeEnv == "" {
		nodeEnv = "development"
	}
	requireKMS := strings.EqualFold(os.Getenv("REQUIRE_KMS"), "true")
	if nodeEnv == "production" && strings.EqualFold(os.Getenv("DEV_SKIP_MTLS"), "true") {
		log.Fatalf("[startup] DEV_SKIP_MTLS=true is forbidden in production")
	}
	if nodeEnv == "production" || requireKMS {
		if os.Getenv("AI_INFRA_KMS_ENDPOINT") == "" && os.Getenv("KMS_ENDPOINT") == "" {
			log.Fatalf("[startup] KMS endpoint is required in production (set AI_INFRA_KMS_ENDPOINT or KMS_ENDPOINT)")
		}
	}
}

func main() {
	runRunner := flag.Bool("run-runner", false, "start the local training runner")
	flag.Parse()

	enforceProdGuardrails()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load: %v", err)
	}
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	st := store.NewPGStore(db)
	signer, err := signing.NewSignerFromConfig(cfg)
	if err != nil {
		log.Fatalf("signer init: %v", err)
	}
	var sentinelClient sentinel.Client = sentinel.NewStaticClient(cfg.SentinelMinScore)
	if cfg.SentinelURL != "" {
		httpClient, err := sentinel.NewHTTPClient(sentinel.HTTPClientConfig{
			BaseURL: cfg.SentinelURL,
			Timeout: 5 * time.Second,
			Retries: 2,
		})
		if err != nil {
			log.Fatalf("sentinel client init: %v", err)
		}
		sentinelClient = httpClient
	}

	svc := service.New(st, sentinelClient, signer)
	server := httpserver.New(cfg, svc, st)

	httpServer := &http.Server{
		Addr:    cfg.Addr,
		Handler: server.Router(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if shouldRunRunner(*runRunner) {
		log.Printf("starting training runner")
		go runner.RunWorker(ctx, svc, st, runner.Config{})
	}

	go func() {
		log.Printf("AI Infra service listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	waitForShutdown(cancel, httpServer)
}

func waitForShutdown(cancel context.CancelFunc, srv *http.Server) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	cancel()
	ctx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func shouldRunRunner(flagValue bool) bool {
	if flagValue {
		return true
	}
	if v := os.Getenv("AI_INFRA_RUNNER"); v != "" {
		enabled, err := strconv.ParseBool(v)
		return err == nil && enabled
	}
	return false
}
