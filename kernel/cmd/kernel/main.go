package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
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
	tlsutil "github.com/ILLUVRSE/Main/kernel/internal/tls"
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
		// In production we require a configured KMS endpoint.
		if cfg.KMSEndpoint == "" {
			log.Fatalf("REQUIRE_KMS=true but KMS_ENDPOINT not configured")
		}
		ks, err := signer.NewKMSSigner(cfg.KMSEndpoint, cfg.RequireKMS)
		if err != nil {
			log.Fatalf("failed to initialize KMS signer: %v", err)
		}
		signClient = ks
	} else {
		// Try to use KMS if an endpoint is set; otherwise fall back to local signer for dev.
		if cfg.KMSEndpoint != "" {
			ks, err := signer.NewKMSSigner(cfg.KMSEndpoint, cfg.RequireKMS)
			if err == nil && ks != nil {
				signClient = ks
				log.Printf("KMS signer configured (endpoint=%s)", cfg.KMSEndpoint)
			} else {
				log.Printf("KMS signer not available: %v — falling back to local signer (dev only)", err)
				signClient = signer.NewLocalSigner(cfg.LocalSignerID)
			}
		} else {
			signClient = signer.NewLocalSigner(cfg.LocalSignerID)
		}
	}

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

	// --- Audit streamer wiring (DB-first durable pipeline) ---
	var (
		streamerCancel context.CancelFunc
	)
	// Only start streamer when we have Postgres (durable DB) and required infra configured.
	if db != nil {
		kafkaBrokersEnv := strings.TrimSpace(os.Getenv("KAFKA_BROKERS"))
		kafkaTopic := strings.TrimSpace(os.Getenv("KAFKA_TOPIC"))
		s3Bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
		s3Prefix := strings.TrimSpace(os.Getenv("S3_PREFIX")) // optional

		if kafkaBrokersEnv != "" && kafkaTopic != "" && s3Bucket != "" {
			rawBrokers := strings.Split(kafkaBrokersEnv, ",")
			brokers := make([]string, 0, len(rawBrokers))
			for _, b := range rawBrokers {
				b = strings.TrimSpace(b)
				if b != "" {
					brokers = append(brokers, b)
				}
			}

			kafkaCfg := audit.KafkaProducerConfig{
				Brokers:     brokers,
				Topic:       kafkaTopic,
				MaxAttempts: 3,
			}
			producer, err := audit.NewKafkaProducer(kafkaCfg)
			if err != nil {
				log.Fatalf("failed to initialize kafka producer: %v", err)
			}
			log.Printf("kafka producer initialized (brokers=%v topic=%s)", brokers, kafkaTopic)

			archiver, err := audit.NewS3Archiver(context.Background(), s3Bucket, s3Prefix)
			if err != nil {
				log.Fatalf("failed to initialize s3 archiver: %v", err)
			}
			log.Printf("s3 archiver initialized (bucket=%s prefix=%s)", s3Bucket, s3Prefix)

			batchSize := 10
			if v := strings.TrimSpace(os.Getenv("STREAM_BATCH_SIZE")); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 {
					batchSize = n
				}
			}
			maxConcurrency := 5
			if v := strings.TrimSpace(os.Getenv("STREAM_MAX_CONCURRENCY")); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 {
					maxConcurrency = n
				}
			}
			pollInterval := 3 * time.Second
			if v := strings.TrimSpace(os.Getenv("STREAM_POLL_INTERVAL_SECONDS")); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 {
					pollInterval = time.Duration(n) * time.Second
				}
			}

			pgStore, ok := store.(*audit.PGStore)
			if !ok {
				log.Printf("audit store is not Postgres-backed; skipping audit streamer startup")
			} else {
				streamerCfg := audit.StreamerConfig{
					BatchSize:      batchSize,
					PollInterval:   pollInterval,
					MaxConcurrency: maxConcurrency,
				}
				streamer := audit.NewStreamer(pgStore, producer, archiver, streamerCfg)

				ctxStr, cancel := context.WithCancel(context.Background())
				streamerCancel = cancel
				go func() {
					if err := streamer.Run(ctxStr); err != nil && err != context.Canceled {
						log.Printf("[audit.streamer] exited with error: %v", err)
					}
					log.Printf("[audit.streamer] background runner stopped")
				}()
				log.Printf("audit streamer started (batch=%d concurrency=%d poll=%s)", batchSize, maxConcurrency, pollInterval)
			}
		} else {
			log.Println("audit streamer not started: KAFKA_BROKERS, KAFKA_TOPIC, and S3_BUCKET must be set to enable")
		}
	} else {
		log.Println("no postgres configured; audit streamer disabled (requires durable DB)")
	}

	// Router and middleware
	r := chi.NewRouter()

	// Auth middleware (mTLS / OIDC extraction)
	r.Use(auth.NewMiddleware(cfg))

	// --- OIDC / JWKS wiring (from cfg) ---
	jwksURL := strings.TrimSpace(cfg.JWKSURL)
	jwksTTLSeconds := cfg.JWKSCacheTTLSeconds
	oidcIssuer := strings.TrimSpace(cfg.OIDCIssuer)
	oidcAudience := strings.TrimSpace(cfg.OIDCAudience)

	// prepare jwks variable and metrics stop func so they are visible below
	var jwks *auth.JWKSCache
	var jwksMetricsStop func()

	if jwksURL != "" {
		// Small health probe so we log meaningful errors early (non-fatal).
		client := &http.Client{Timeout: 2 * time.Second}
		if resp, err := client.Get(jwksURL); err != nil {
			log.Printf("warning: JWKS URL %s not reachable right now: %v (middleware will still be installed)", jwksURL, err)
		} else {
			_ = resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 400 {
				log.Printf("warning: JWKS URL %s returned HTTP %d (middleware will still be installed)", jwksURL, resp.StatusCode)
			}
		}

		jwks = auth.NewJWKSCache(jwksURL, time.Duration(jwksTTLSeconds)*time.Second)

		// Start JWKS metrics updater
		jwksMetricsStop = auth.StartJWKSMetricsUpdater(jwks, 15*time.Second)
		log.Printf("JWKS metrics updater started (interval=15s)")

		r.Use(auth.OIDCMiddleware(jwks, oidcIssuer, oidcAudience))
		log.Printf("OIDC middleware configured (jwks=%s issuer=%s audience=%s ttl=%ds)", jwksURL, oidcIssuer, oidcAudience, jwksTTLSeconds)
	} else {
		log.Println("OIDC JWKS_URL not configured in cfg; skipping OIDC middleware (roles will not be validated)")
	}

	// Mount the security/status endpoint for key registry and jwks metrics
	r.Get("/kernel/security/status", reg.StatusHandler())
	r.Get("/kernel/security/jwks_metrics", handlers.JWKSStatusHandler(jwks))

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

	// --- TLS / mTLS setup using cfg paths ---
	certPath := strings.TrimSpace(cfg.TLSCertPath)
	keyPath := strings.TrimSpace(cfg.TLSKeyPath)
	clientCAPath := strings.TrimSpace(cfg.TLSClientCAPath)

	if certPath != "" && keyPath != "" {
		tlsCfg, err := tlsutil.NewTLSConfigFromFiles(certPath, keyPath, clientCAPath, cfg.RequireMTLS)
		if err != nil {
			log.Fatalf("failed to initialize TLS config: %v", err)
		}
		srv.TLSConfig = tlsCfg

		// Start TLS server
		go func() {
			log.Printf("starting kernel server (TLS) on %s", cfg.ListenAddr)
			if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				log.Fatalf("server failed: %v", err)
			}
		}()
	} else {
		// Plain HTTP server
		go func() {
			log.Printf("starting kernel server on %s", cfg.ListenAddr)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Fatalf("server failed: %v", err)
			}
		}()
	}

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down server...")

	// First stop accepting new HTTP requests and wait for inflight requests.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}

	// Cancel streamer if started and give it a short grace period to finish.
	if streamerCancel != nil {
		streamerCancel()
		// give streamer up to 10s to drain in-flight work; it will also close the producer.
		shutdownWait := time.NewTimer(10 * time.Second)
		<-shutdownWait.C
	}

	// Stop JWKS metrics updater if started
	if jwksMetricsStop != nil {
		jwksMetricsStop()
		log.Println("JWKS metrics updater stopped")
	}

	if db != nil {
		_ = db.Close()
	}
	log.Println("server stopped")
}
