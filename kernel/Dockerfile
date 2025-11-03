# kernel/Dockerfile
# Multi-stage Dockerfile for the ILLUVRSE Kernel service.
#
# - Builder stage installs dev deps, builds TS -> JS (dist).
# - Runner stage installs only production deps, copies built artifacts,
#   runs as non-root user and executes an entrypoint that runs migrations
#   and starts the server.
#
# Build (from repo root):
#   docker build -t illuvrse-kernel:local -f kernel/Dockerfile kernel
#
# Run (local dev):
#   docker run --rm -e POSTGRES_URL="postgresql://postgres:postgres@host.docker.internal:5432/illuvrse" \
#     -p 3000:3000 illuvrse-kernel:local
#
# Notes:
# - The Dockerfile expects the `kernel/entrypoint.sh` file to exist and be executable.
# - DO NOT bake secrets into the image. Provide POSTGRES_URL, KMS_ENDPOINT, SIGNER_ID via env or host secret management.

############################
# Builder stage
############################
FROM node:20-alpine AS builder

# Install build deps needed for native modules (none expected but keep minimal tools)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package.json package-lock.json ./

# Install all deps (including dev) for building TypeScript.
RUN npm ci

# Copy package sources and build
COPY . .
# Build JS into ./dist
RUN npm run build

############################
# Runner stage
############################
FROM node:20-alpine AS runner

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Copy package files and install only production deps to keep image small
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy migrations and supporting files needed at runtime
# (Assumes Docker build context is the kernel/ directory)
COPY sql/migrations ./sql/migrations
COPY entrypoint.sh ./entrypoint.sh

# Ensure entrypoint is executable
RUN chmod +x ./entrypoint.sh

# Switch to non-root user
USER appuser

EXPOSE 3000

# Entrypoint will run migrations and then start the server (node dist/server.js)
CMD ["./entrypoint.sh"]

# -------------------------
# Acceptance criteria (testable)
#
# - Image builds successfully:
#   Test: `docker build -t illuvrse-kernel:local -f kernel/Dockerfile kernel` -> exits 0.
#
# - Container runs and /health responds:
#   Test: `docker run --rm -e POSTGRES_URL="postgresql://postgres:postgres@<db-host>:5432/illuvrse" -p3000:3000 illuvrse-kernel:local`
#         then `curl -sS http://localhost:3000/health` -> JSON `{ "status":"ok", "ts": "..." }`.
#
# - Migrations available in image:
#   Test: `docker run --rm illuvrse-kernel:local ls -la /app/sql/migrations` -> shows 001_init.sql.
#
# - Image runs as non-root user:
#   Test: `docker run --rm illuvrse-kernel:local id -u` should not return 0 (or container logs show no root usage).
#
# - No secrets baked into image:
#   Test: ensure `docker history` and filesystem contain no .env or secrets files.
#
# Operational note:
# - Create `kernel/entrypoint.sh` next (it will run migrations and start node). DO NOT commit secrets in the entrypoint.

