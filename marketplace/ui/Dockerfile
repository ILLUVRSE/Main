# Stage 1 — build
FROM node:18-bullseye AS builder
WORKDIR /usr/src/app

# Install dependencies (use package-lock if present)
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source
COPY . .

# Build the Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2 — production image
FROM node:18-bullseye-slim AS runner
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install a minimal set of dependencies needed to run the production build
COPY package.json package-lock.json* ./
RUN npm ci --production --silent

# Copy built output and necessary files from builder
COPY --from=builder /usr/src/app/.next .next
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/next.config.js ./next.config.js
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./package.json

# Expose port expected by Next (override at runtime if desired)
EXPOSE 3000

# Recommended runtime envs (set these in kubernetes/ecs or with docker -e)
# NEXT_PUBLIC_MARKETPLACE_BASE_URL - backend API URL
# NEXT_PUBLIC_APP_ENV - 'production' or 'staging'
ENV NEXT_PUBLIC_MARKETPLACE_BASE_URL=http://127.0.0.1:3000
ENV NEXT_PUBLIC_APP_ENV=production

# Start in production mode
CMD ["npm", "start"]

