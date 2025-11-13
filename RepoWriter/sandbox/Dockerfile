# Minimal, locked-down container used to run RepoWriter tests/typecheck/lint inside a sandbox.
# Non-root user, no network by default (docker run will use --network none), small memory/cpu footprint.
FROM node:20-slim

# Create non-root user for improved safety
RUN useradd -m -s /bin/bash repowriter

WORKDIR /home/repowriter

# Install minimal native build tools and git (needed for many JS/TS projects)
# Keep packages minimal and squash apt lists to reduce image size.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

# Install developer tools (TypeScript, ESLint). Keep them global for sandbox runs.
RUN npm install -g typescript eslint

# Drop to non-root user
USER repowriter

# Default entrypoint: run the provided bash command inside the container
ENTRYPOINT ["bash", "-lc"]
