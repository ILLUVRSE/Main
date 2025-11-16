// RepoWriter/server/test/allowlistEnforcer.unit.ts
// Vitest unit tests for allowlistEnforcer middleware

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

import allowlistEnforcer from "../../src/middleware/allowlistEnforcer";

describe("allowlistEnforcer middleware", () => {
  let tmpdir: string;
  let allowfile: string;

  beforeEach(async () => {
    tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "allowlist-"));
    allowfile = path.join(tmpdir, "allow.json");
    delete process.env.REPOWRITER_ALLOWLIST_PATH;
    vi.resetAllMocks();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpdir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env.REPOWRITER_ALLOWLIST_PATH;
  });

  it("allows a patch that is within an allowed path", async () => {
    const allowlist = { allowed_paths: ["RepoWriter/", "src/"], forbidden_paths: ["infra/", ".github/"] };
    await fs.writeFile(allowfile, JSON.stringify(allowlist), "utf8");
    process.env.REPOWRITER_ALLOWLIST_PATH = allowfile;

    const mw = allowlistEnforcer();
    const req: any = { body: { patches: [{ path: "RepoWriter/server/foo.txt" }] } };

    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects forbidden path (forbidden prefix)", async () => {
    const allowlist = { allowed_paths: ["src/"], forbidden_paths: ["infra/", ".github/"] };
    await fs.writeFile(allowfile, JSON.stringify(allowlist), "utf8");
    process.env.REPOWRITER_ALLOWLIST_PATH = allowfile;

    const mw = allowlistEnforcer();
    const req: any = { body: { patches: [{ path: ".github/workflows/deploy.yml" }] } };

    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
  });

  it("rejects path not under any allowed prefix", async () => {
    const allowlist = { allowed_paths: ["src/"], forbidden_paths: [] };
    await fs.writeFile(allowfile, JSON.stringify(allowlist), "utf8");
    process.env.REPOWRITER_ALLOWLIST_PATH = allowfile;

    const mw = allowlistEnforcer();
    const req: any = { body: { patches: [{ path: "secrets/.env" }] } };

    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
  });

  it("rejects path traversal outside repo root", async () => {
    const allowlist = { allowed_paths: ["src/"], forbidden_paths: [] };
    await fs.writeFile(allowfile, JSON.stringify(allowlist), "utf8");
    process.env.REPOWRITER_ALLOWLIST_PATH = allowfile;

    const mw = allowlistEnforcer();
    const req: any = { body: { patches: [{ path: "../etc/passwd" }] } };

    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });
});

