# Reasoning Graph Authentication

This service enforces strict Kernel-only authentication for write operations.

## Overview

All write endpoints (`POST /nodes`, `POST /edges`, `POST /traces`) require authentication.
There are two supported methods:
1. **mTLS (Mutual TLS)**: The client certificate is verified.
2. **Kernel-Signed Token**: A JWT signed by the Kernel.

Read operations may be public or protected depending on configuration, but this document focuses on writes.

## Configuration

The following environment variables control authentication:

| Variable | Description | Default |
|----------|-------------|---------|
| `REASONING_ALLOW_MTLS` | Enable mTLS authentication | `false` |
| `KERNEL_SIGNER_KEYS_FILE` | Path to file containing Kernel public keys (PEM format) | (empty) |
| `REASONING_WRITE_SCOPE` | Required JWT scope/role for write access | `reasoning:write` |
| `REASONING_DEV_ALLOW_LOCAL`| Enable `X-Local-Dev-Principal` header for local dev | `false` |

## Authentication Methods

### 1. mTLS

To use mTLS:
- The service must be running with TLS enabled.
- The client must present a valid certificate trusted by the CA.
- The certificate should ideally identify as "Kernel" (CN or SPIFFE ID), though currently any trusted client cert is accepted if `REASONING_ALLOW_MTLS=true`.

### 2. Kernel-Signed Token

To use a token:
- Include the token in the `Authorization` header: `Bearer <token>`.
- The token must be a JWT signed by one of the keys in `KERNEL_SIGNER_KEYS_FILE`.
- The token must have the scope (or role) defined in `REASONING_WRITE_SCOPE`.
- The issuer (`iss`) should ideally be `kernel`.

### Development Mode

For local development ONLY, you can bypass auth by:
1. Setting `REASONING_DEV_ALLOW_LOCAL=true`.
2. Sending the header `X-Local-Dev-Principal: <identity>`.

**WARNING**: Never enable this in production.

## How to Verify (CI/Test)

To generate a test token:
1. Use the `reasoning-graph/test/generate_token.go` helper (or similar) to sign a JWT with a generated key.
2. Configure the service to trust that key via `KERNEL_SIGNER_KEYS_FILE`.

## Proxy Configuration

If running behind a proxy/gateway:
- Ensure the proxy forwards the client certificate or validates it and forwards the identity in a trusted header.
- The current implementation expects direct mTLS or checks standard JWT headers.
