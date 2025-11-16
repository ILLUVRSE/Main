# memory-layer/Dockerfile
# Multi-stage build:
#  - builder: installs deps, builds TypeScript, prunes dev deps
#  - runtime: small runtime image with production deps and compiled assets

###############################################################################
# Builder stage
###############################################################################
FROM node:20-alpine AS builder

# Install git / python / make if needed by native deps (optional)
RUN apk add --no-cache python3 make g++ git

WORKDIR /build

# Copy only what's necessary first for caching
COPY memory-layer/package.json memory-layer/package-lock.json* ./memory-layer/

# If the repo uses a root-level package.json with workspaces, we may need the repo root.
# Copy minimal project (safe fallback to copy entire repo if needed)
COPY . .

# Install all deps (including dev for the TypeScript build), build, then prune dev deps.
WORKDIR /build/memory-layer

RUN npm ci \
  && npm run memory-layer:build \
  && npm prune --production

# After build we expect:
#  - dist/ contains compiled JS
#  - node_modules/ contains production deps
#  - package.json present

###############################################################################
# Runtime stage
###############################################################################
FROM node:20-slim

# Create an app directory
WORKDIR /app

# Copy built artifacts and production node_modules from builder
COPY --from=builder /build/memory-layer/dist ./dist
COPY --from=builder /build/memory-layer/package.json ./package.json
COPY --from=builder /build/memory-layer/node_modules ./node_modules
COPY --from=builder /build/memory-layer/memory-layer/spec ./memory-layer/spec 2>/dev/null || true
COPY --from=builder /build/memory-layer/memory-layer/sql ./memory-layer/sql 2>/dev/null || true

# Create a non-root user for running the service
RUN groupadd -g 1000 illuvrse || true \
  && useradd -r -u 1000 -g illuvrse -m -d /home/illuvrse -s /sbin/nologin illuvrse \
  && chown -R illuvrse:illuvrse /app

# Install minimal tools needed for healthcheck (curl)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Default environment
ENV NODE_ENV=production
ENV PORT=4300
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Create an entrypoint script that runs migrations optionally and then starts the server.
# It is created in the image at build time so you don't need to add a separate file.
RUN cat > /usr/local/bin/docker-entrypoint.sh <<'EOF'
#!/bin/sh
set -e

# Helpful logging
echo "[entrypoint] starting with NODE_ENV=${NODE_ENV:-}${NODE_ENV:+, REQUIRE_KMS=${REQUIRE_KMS:-}}"

# Optional migration run: set MIGRATE_ON_START=true to run migrations on container start.
# This is conservative—many operators prefer running migrations as a separate job.
if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] MIGRATE_ON_START=true, attempting to run migrations"
  if [ -f ./dist/memory-layer/scripts/runMigrations.js ]; then
    echo "[entrypoint] Running migrations via compiled runner"
    # pass the default migrations directory if not specified
    MDIR=${MIGRATIONS_DIR:-"./dist/memory-layer/sql/migrations"}
    node ./dist/memory-layer/scripts/runMigrations.js "${MDIR}"
  else
    echo "[entrypoint] WARNING: migration runner not found at ./dist/memory-layer/scripts/runMigrations.js; skipping migrations"
  fi
fi

# Protect against starting without an audit signer in strict mode:
# The memory-layer server enforces REQUIRE_KMS or NODE_ENV=production guard itself,
# but we print a helpful hint here too.
if [ "${NODE_ENV}" = "production" ] || [ "${REQUIRE_KMS:-}" = "true" ]; then
  if [ -z "${AUDIT_SIGNING_KMS_KEY_ID:-}" ] && [ -z "${SIGNING_PROXY_URL:-}" ] && \
     [ -z "${AUDIT_SIGNING_KEY:-}" ] && [ -z "${AUDIT_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${AUDIT_SIGNING_SECRET:-}" ]; then
    echo "[entrypoint][ERROR] No audit signer configured (one of AUDIT_SIGNING_KMS_KEY_ID | SIGNING_PROXY_URL | AUDIT_SIGNING_KEY/AUDIT_SIGNING_PRIVATE_KEY/AUDIT_SIGNING_SECRET must be set)."
    echo "[entrypoint][ERROR] This image is running with NODE_ENV=production or REQUIRE_KMS=true. To start anyway for debugging set NODE_ENV=development or REQUIRE_KMS=false."
    exit 1
  fi
fi

# Drop privileges and exec server
echo "[entrypoint] launching memory-layer server (port=${PORT})"
exec su-exec illuvrse node ./dist/memory-layer/service/server.js
EOF

# Make the entrypoint executable
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Use su-exec to drop privileges at runtime (install tiny wrapper)
RUN apt-get update \
  && apt-get install -y --no-install-recommends su-exec \
  && rm -rf /var/lib/apt/lists/*

# Expose port
EXPOSE 4300

# Minimal healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-4300}/healthz || exit 1

# Run as non-root user by default
USER illuvrse

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "./dist/memory-layer/service/server.js"]

