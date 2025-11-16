// RepoWriter/server/test/signing.unit.ts
// Vitest unit tests for signManifest (signing proxy + HMAC fallback + production fail-closed)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as signModule from "../../kernel/sign";

const ORIGINAL_FETCH = (globalThis as any).fetch;
const origEnv: Record<string, string | undefined> = {
  SIGNING_PROXY_URL: process.env.SIGNING_PROXY_URL,
  SIGNING_PROXY_API_KEY: process.env.SIGNING_PROXY_API_KEY,
  REQUIRE_SIGNING_PROXY: process.env.REQUIRE_SIGNING_PROXY,
  NODE_ENV: process.env.NODE_ENV,
  REPOWRITER_SIGNING_SECRET: process.env.REPOWRITER_SIGNING_SECRET,
};

describe("signManifest (signing proxy + fallback)", () => {
  beforeEach(() => {
    // Reset mocked fetch and env keys used by tests
    (globalThis as any).fetch = ORIGINAL_FETCH;
    delete process.env.SIGNING_PROXY_URL;
    delete process.env.SIGNING_PROXY_API_KEY;
    delete process.env.REQUIRE_SIGNING_PROXY;
    delete process.env.NODE_ENV;
    process.env.REPOWRITER_SIGNING_SECRET = "test-secret";
    vi.resetAllMocks();
  });

  afterEach(() => {
    // restore fetch and env
    (globalThis as any).fetch = ORIGINAL_FETCH;
    process.env.SIGNING_PROXY_URL = origEnv.SIGNING_PROXY_URL;
    process.env.SIGNING_PROXY_API_KEY = origEnv.SIGNING_PROXY_API_KEY;
    process.env.REQUIRE_SIGNING_PROXY = origEnv.REQUIRE_SIGNING_PROXY;
    process.env.NODE_ENV = origEnv.NODE_ENV;
    process.env.REPOWRITER_SIGNING_SECRET = origEnv.REPOWRITER_SIGNING_SECRET;
  });

  it("uses signing proxy when configured and proxy returns ok", async () => {
    process.env.SIGNING_PROXY_URL = "http://mock-signer.local";
    // mock fetch to return OK with signature_b64 and signer_id
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        signature_b64: Buffer.from("signed-by-proxy").toString("base64"),
        signer_id: "signer-42",
      }),
    });

    const res = await signModule.signManifest({ id: "m1" });
    expect(res.signature).toBe(Buffer.from("signed-by-proxy").toString("base64"));
    expect(res.signerId).toBe("signer-42");
  });

  it("falls back to HMAC when proxy returns non-OK and REQUIRE_SIGNING_PROXY is not set", async () => {
    process.env.SIGNING_PROXY_URL = "http://mock-signer.local";
    // simulate proxy failure (non-ok)
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });

    const res = await signModule.signManifest({ id: "m2" });
    expect(res.signature).toBeDefined();
    expect(typeof res.signature).toBe("string");
    // HMAC SHA256 hex length is 64 characters
    expect(res.signature.length).toBe(64);
    expect(res.signerId).toBeUndefined();
  });

  it("throws when proxy fails and REQUIRE_SIGNING_PROXY=1", async () => {
    process.env.SIGNING_PROXY_URL = "http://mock-signer.local";
    process.env.REQUIRE_SIGNING_PROXY = "1";
    // ensure we simulate a failing proxy
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });

    await expect(signModule.signManifest({ id: "m3" })).rejects.toThrow();
  });

  it("throws when SIGNING_PROXY_URL is set but response missing fields", async () => {
    process.env.SIGNING_PROXY_URL = "http://mock-signer.local";
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    });

    // Without REQUIRE_SIGNING_PROXY, fallback occurs; to assert missing-field rejection,
    // enable REQUIRE_SIGNING_PROXY so failure is thrown.
    process.env.REQUIRE_SIGNING_PROXY = "1";
    await expect(signModule.signManifest({ id: "m4" })).rejects.toThrow(
      /Invalid response from signing proxy|Signing proxy error/
    );
  });
});

