# devops/keycloak/README.md

This directory contains a small wrapper for Keycloak used by the CI/dev compose.

## Purpose

We attempted to install `curl` into the upstream Keycloak image to enable an HTTP-based
healthcheck that queries `/realms/master`. Many Keycloak images are minimal and do not
include a package manager (or the package manager is not available in that image),
so installing `curl` during image build can fail.

To keep the local/CI flow simple and robust, the compose file uses a **port-listening**
healthcheck for Keycloak which does not require additional tooling inside the container.

## Healthcheck details

The compose `healthcheck` (in `devops/docker-compose.ci.yml`) uses:

```yaml
healthcheck:
  test: ["CMD-SHELL", "sh -c \"cat /proc/net/tcp | grep -q ':1F90\\b' || exit 1\""]
  interval: 5s
  timeout: 5s
  retries: 36

This checks whether port 8080 (hex 1F90) is present in /proc/net/tcp, i.e. Keycloak has opened the port.

Tradeoffs

Pros

Portable: does not depend on curl, wget, or any package manager being present.

Reliable for startup ordering: confirms the process has opened the expected port.

Cons

Does not validate the HTTP response/body (e.g., that /realms/master returns a successful JSON).

For production-grade checks you should prefer an HTTP endpoint healthcheck (and ensure the image includes curl or a similar tool), or install a minimal health-check script into the image.

If you want HTTP-level healthchecks

Two options:

Build a custom Keycloak image that includes curl/wget and keep the HTTP healthcheck. Example Dockerfile:

FROM quay.io/keycloak/keycloak:21.1.1
USER root
# Install curl (method depends on base distro)
RUN microdnf -y install curl || yum -y install curl || dnf -y install curl
USER 1000

Then revert the healthcheck to:
test: ["CMD-SHELL", "curl --fail -s http://localhost:8080/realms/master > /dev/null || exit 1"]



Add a small health-check binary/script into your Keycloak image that performs a safe HTTP check; keep your HTTP healthcheck in compose.
