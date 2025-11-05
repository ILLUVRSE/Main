# devops/keycloak/Dockerfile
# Minimal wrapper for Keycloak used by CI/dev compose.
# No package installation here — healthcheck uses a port-listen check.
FROM quay.io/keycloak/keycloak:21.1.1

# Keep default user and entrypoint from the upstream image.
USER 1000
