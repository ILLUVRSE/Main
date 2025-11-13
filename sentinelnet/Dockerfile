# Build stage: install deps and compile TS
FROM node:18-alpine AS builder
WORKDIR /app
# Install build tools
RUN apk add --no-cache python3 make g++ bash

# Copy package manifests first for deterministic installs
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage: smaller image with only production deps and compiled code
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Add minimal runtime deps for TLS or utils if needed
RUN apk add --no-cache ca-certificates bash

COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Default port (can be overridden by env)
EXPOSE 7602

# Healthcheck (basic)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:7602/health || exit 1

CMD ["node", "dist/server.js"]

