# Stage 1: dependencies & build
FROM node:18-alpine AS builder

# Install build deps
RUN apk add --no-cache python3 make g++ bash git

WORKDIR /app

# Copy package files first to leverage layer caching
COPY package*.json ./
# If there is a workspace package.json in ui we won't copy here; server should manage its own dependencies.
RUN npm ci --production=false

# Copy rest of server sources
COPY . .

# If project uses tsc, build typescript
RUN if [ -f tsconfig.json ]; then \
      npm run build --if-present; \
    fi

# Stage 2: runtime image
FROM node:18-alpine AS runtime

RUN apk add --no-cache ca-certificates

# Create app user for non-root execution
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
# Copy built files or source (if build not present, runtime will use source)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/lib ./lib || true

# Default envs (can be overridden)
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

# Ensure data directory exists and is writable
RUN mkdir -p /app/data && chown -R app:app /app

USER app

# Expose port
EXPOSE 8080

# If a production build exists run it; otherwise run ts-node / node on server
CMD ["sh", "-c", "if [ -d dist ]; then node dist/server/server.js; elif [ -f server/server.js ]; then node server/server.js; else node server/server.ts; fi"]

