// RepoWriter/server/src/startupCheck.ts
// Startup sanity checks for RepoWriter server.
//
// This module performs a few lightweight checks that surface common
// misconfiguration early (before the server starts accepting requests).
//
// - Ensures signing proxy is configured when REQUIRE_SIGNING_PROXY=1 in production.
// - Ensures global `fetch` is available if SIGNING_PROXY_URL is set.
// - Ensures REPO_PATH exists and is readable/writable.
//
// Usage: import { runStartupChecks } from './startupCheck';
//        await runStartupChecks(); // before starting the HTTP server

import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";

function env(name: string, fallback?: string): string | undefined {
  const v = (process.env[name] || "").trim();
  return v === "" ? fallback : v;
}

/**
 * runStartupChecks
 * throws on fatal misconfiguration.
 */
export async function runStartupChecks(): Promise<void> {
  // Repo path check
  const repoPath = env("REPO_PATH", process.cwd());
  try {
    // Check read + write accessibility
    await fs.access(repoPath, fsConstants.R_OK | fsConstants.W_OK);
  } catch (err: any) {
    throw new Error(
      `REPO_PATH is not accessible or does not exist: ${repoPath}. ` +
        `Ensure REPO_PATH points to the repository root and the process has r/w permission. Original: ${String(err?.message ?? err)}`
    );
  }

  // Signing proxy / KMS checks
  const nodeEnv = env("NODE_ENV", "development");
  const requireSigningProxy = env("REQUIRE_SIGNING_PROXY", "0") === "1";
  const signingProxyUrl = env("SIGNING_PROXY_URL");

  if (nodeEnv === "production" && requireSigningProxy && !signingProxyUrl) {
    throw new Error(
      "Production requires a signing proxy but SIGNING_PROXY_URL is not configured. " +
        "Set SIGNING_PROXY_URL and SIGNING_PROXY_API_KEY (if required) or disable REQUIRE_SIGNING_PROXY."
    );
  }

  if (signingProxyUrl) {
    // Ensure global fetch is available (signingProxyClient expects it)
    if (typeof (globalThis as any).fetch !== "function") {
      throw new Error(
        "Global `fetch` is not available but SIGNING_PROXY_URL is configured. " +
          "Ensure Node 18+ (native fetch) or polyfill fetch (undici/node-fetch) before starting."
      );
    }
  }

  // Optional: warn if in production and signing proxy present but REQUIRE_SIGNING_PROXY not set.
  if (nodeEnv === "production" && signingProxyUrl && !requireSigningProxy) {
    console.warn(
      "[startupCheck] SIGNING_PROXY_URL is configured in production but REQUIRE_SIGNING_PROXY is not set to 1. " +
        "This allows fallback to the HMAC dev signer on proxy failure. To enforce KMS-only signing set REQUIRE_SIGNING_PROXY=1."
    );
  }

  // Optional: check minimal OpenAI config for dev/prod
  const openaiKey = env("OPENAI_API_KEY");
  const openaiUrl = env("OPENAI_API_URL");
  const allowNoKey = env("REPOWRITER_ALLOW_NO_KEY", "0") === "1";
  const sandboxEnabled = env("SANDBOX_ENABLED", "0") === "1";

  if (nodeEnv === "production") {
    if (!openaiKey && !openaiUrl && !allowNoKey && !sandboxEnabled) {
      console.warn(
        "[startupCheck] No OPENAI_API_KEY or OPENAI_API_URL configured for production. " +
          "If this server relies on OpenAI in production, ensure one of these is set or enable SANDBOX/allow flags appropriately."
      );
    }
  }

  // All checks passed
  return;
}

export default { runStartupChecks };

