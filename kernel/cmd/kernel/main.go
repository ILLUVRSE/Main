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

	"github.com/go-chi/chi/v5"
	_ "github.com/lib/pq"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/auth"
	"github.com/ILLUVRSE/Main/kernel/internal/config"
	"github.com/ILLUVRSE/Main/kernel/internal/handlers"
	"github.com/ILLUVRSE/Main/kernel/internal/keys"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// AppContext holds shared dependencies passed to handlers.
type AppContext struct {
	Config *config.Config
	DB     *sql.DB
	Signer signer.Signer
	Store  audit.Store
	// Registry is intentionally not required by handlers but available for other subsystems.
	Registry *keys.Registry
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Load configuration
	cfg := config.LoadFromEnv()

	// Database (optional)
	var db *sql.DB
	if cfg.DatabaseURL != "" {
		var err error
		db, err = sql.Open("postgres", cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("failed to open postgres: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			log.Fatalf("failed to ping postgres: %v", err)
		}
		log.Println("connected to postgres")
	}

	// Signer: prefer KMS in prod; fallback to local signer for dev/testing
	var signClient signer.Signer
	if cfg.RequireKMS {
		if cfg.KMSEndpoint == "" {
			log.Println("WARNING: REQUIRE_KMS=true but KMS_ENDPOINT not set — using local signer (NOT FOR PROD)")
		}
		// TODO: wire a KMS signer here. For now we fall back to local signer.
	}
	signClient = signer.NewLocalSigner(cfg.LocalSignerID)

	// Store: Postgres-backed store when DB present, otherwise local file store for dev
	var store audit.Store
	if db != nil {
		store = audit.NewPGStore(db)
	} else {
		store = audit.NewFileStore("./archive")
	}

	// Key registry - register the signer public key so auditors can discover it
	reg := keys.NewRegistry()
	if pk := signClient.PublicKey(); pk != nil {
		// Attempt to obtain signerId by asking signer to sign a small probe.
		// This yields the signerId returned by Sign(). This is cheap and safe for local signer.
		if sig, sid, err := signClient.Sign([]byte("kernel-registry-probe")); err == nil && sid != "" && len(pk) > 0 && len(sig) > 0 {
			reg.AddSigner(sid, pk, "Ed25519")
			log.Printf("registered signer %s in key registry", sid)
		} else {
			log.Println("warning: could not register signer in registry:", err)
		}
	}

	app := &AppContext{
		Config:   cfg,
		DB:       db,
		Signer:   signClient,
		Store:    store,
		Registry: reg,
	}

	// Router and middleware
	r := chi.NewRouter()

	// Auth middleware (mTLS / OIDC extraction)
	r.Use(auth.NewMiddleware(cfg))

	// Mount the security/status endpoint for key registry
	r.Get("/kernel/security/status", reg.StatusHandler())

	// Register kernel routes (handlers.RegisterRoutes uses reflection to pull dependencies from app)
	handlers.RegisterRoutes(app, r)

	// HTTP server
	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server
	go func() {
		log.Printf("starting kernel server on %s", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
	if db != nil {
		_ = db.Close()
	}
	log.Println("server stopped")
}

