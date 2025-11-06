# devops/keycloak/Dockerfile
# Minimal wrapper for Keycloak used by CI/dev compose.
# Install curl so healthchecks that use curl succeed in images that don't include it.
FROM quay.io/keycloak/keycloak:21.1.1

LABEL maintainer="ILLUVRSE Dev <devops@illuvrse.local>"

# Temporarily become root so we can install curl in the image.
USER root

# Try common package managers to install curl in a portable way.
# If none exist, do not fail the build so the image still builds (healthcheck will still fail).
RUN set -eux; \
  if command -v microdnf >/dev/null 2>&1; then \
    microdnf -y install curl || true; \
    microdnf clean all || true; \
  elif command -v yum >/dev/null 2>&1; then \
    yum -y install curl || true; \
    yum -y clean all || true; \
  elif command -v dnf >/dev/null 2>&1; then \
    dnf -y install curl || true; \
    dnf -y clean all || true; \
  elif command -v apk >/dev/null 2>&1; then \
    apk add --no-cache curl || true; \
  else \
    echo "No known package manager to install curl (build will continue)"; \
  fi

# Add a container-level HEALTHCHECK as a backup if compose doesn't define one.
# This uses the Quarkus readiness endpoint which Keycloak exposes at /q/health/ready.
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD curl -f http://localhost:8080/q/health/ready || exit 1

# Drop back to the non-root user expected by upstream image.
USER 1000

