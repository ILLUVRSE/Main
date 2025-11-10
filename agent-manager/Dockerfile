# agent-manager/Dockerfile
# Minimal, reproducible image for Agent Manager (Node 18)
FROM node:18-bullseye-slim AS base

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5176

# Install production dependencies deterministically
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

EXPOSE 5176

# Optional healthcheck (containerized sanity)
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:5176/health || exit 1

CMD ["node", "server/index.js"]

