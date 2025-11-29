package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/ILLUVRSE/Main/eval-engine/internal/api"
	"github.com/ILLUVRSE/Main/eval-engine/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	_ "github.com/lib/pq"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8050"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://user:password@localhost:5432/eval_engine?sslmode=disable"
	}

	financeURL := os.Getenv("FINANCE_URL")
	reasoningURL := os.Getenv("REASONING_GRAPH_URL")

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Printf("Warning: Database unreachable: %v", err)
	}

	svc := service.NewPromotionService(db, financeURL, reasoningURL)
	handler := api.NewPromotionHandler(svc)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	handler.RegisterRoutes(r)

	log.Printf("Eval Engine listening on port %s", port)
	http.ListenAndServe(":"+port, r)
}
