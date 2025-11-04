# kernel/Makefile — dev helper for Kernel module
# Usage examples:
#   make build
#   make run
#   make test
#   make migrate DATABASE_URL="postgres://user:pass@host:5432/dbname?sslmode=disable"

.PHONY: help all build run test migrate fmt vet docker-build clean

BINARY := bin/kernel
PKG := ./kernel/cmd/kernel
MIGRATION := migrations/0001_create_tables.sql

help: 
	@echo "Kernel Makefile:"
	@echo "  make build             Build the kernel binary (output: $(BINARY))"
	@echo "  make run               Run the kernel (go run)"
	@echo "  make test              Run unit tests"
	@echo "  make migrate           Run SQL migrations (requires DATABASE_URL)"
	@echo "  make fmt               Run gofmt -w on the module"
	@echo "  make vet               Run go vet"
	@echo "  make docker-build      Build docker image (requires docker)"
	@echo "  make clean             Remove build artifacts"

all: build

build:
	@echo ">> building kernel binary"
	@mkdir -p $(dir $(BINARY))
	@CGO_ENABLED=0 GOOS=linux go build -o $(BINARY) $(PKG)

run:
	@echo ">> running kernel (use LISTEN_ADDR, DATABASE_URL env vars as needed)"
	@go run $(PKG)

test:
	@echo ">> running go tests"
	@go test ./... -v

migrate:
ifndef DATABASE_URL
	$(error DATABASE_URL is required. Example: make migrate DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=disable")
endif
	@echo ">> applying migrations from $(MIGRATION) to $(DATABASE_URL)"
	@psql "$(DATABASE_URL)" -f $(MIGRATION)

fmt:
	@echo ">> formatting go code"
	@gofmt -s -w .

vet:
	@echo ">> running go vet"
	@go vet ./...

docker-build:
	@echo ">> building docker image illuvrse/kernel:local"
	@docker build -t illuvrse/kernel:local -f Dockerfile ..

clean:
	@echo ">> cleaning build artifacts"
	@rm -rf $(BINARY) ./archive ./data || true

