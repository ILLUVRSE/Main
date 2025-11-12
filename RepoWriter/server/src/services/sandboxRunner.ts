/**
 * sandboxRunner.ts
 *
 * Lightweight sandbox runner for RepoWriter.
 *
 * NOTE: This implementation runs tests on the host inside a temp copy of the repo.
 * For production-grade isolation you should replace this with a Docker / container-based
 * runner that enforces CPU/memory/time/network limits.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { applyPatch } from "diff";
import { REPO_PATH } from "../config.js";

export type PatchInput = {
  path: string;
  content?: string;
  diff?: string;
};

export type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type SandboxOptions = {
  timeoutMs?: number;
  testCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  keepTemp?: boolean;
  maxOutputSize?: number;
  env?: Record<string,string>;
};

export type SandboxResult = {
  ok: boolean;
  tests?: CommandResult;
  typecheck?: CommandResult;
  lint?: CommandResult;
  error?: string;
  timedOut?: boolean;
  tempDir?: string | null;
  logs?: string;
};

/** Helper: run a command in a working directory with timeout. */
async function runCommand(cmd: string, cwd: string, opts: { timeoutMs: number; env?: Record<string,string>; maxOutputSize?: number } = { timeoutMs: 60000 }) : Promise<CommandResult> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, opts.env || {});
    const child = spawn(cmd, { cwd, shell: true, env });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;
    const maxSize = opts.maxOutputSize ?? 20000;

    const cleanupAndResolve = (code: number | null) => {
      if (finished) return;
      finished = true;
      if (stdout.length > maxSize) stdout = stdout.slice(0, maxSize) + "\n...[truncated stdout]";
      if (stderr.length > maxSize) stderr = stderr.slice(0, maxSize) + "\n...[truncated stderr]";
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        timedOut: timedOut || false
      });
    };

    const to = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, opts.timeoutMs);

    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });

    child.on("error", (err) => {
      clearTimeout(to);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: (stderr || "") + `\n[spawn error] ${String(err?.message || err)}`,
        timedOut: timedOut || false
      });
    });

    child.on("close", (code) => {
      clearTimeout(to);
      cleanupAndResolve(code);
    });
  });
}

/** Ensure a path is safe relative path (no traversal) */
function validateRelativePath(p: string) {
  if (!p || typeof p !== "string") throw new Error("Invalid path");
  if (p.startsWith("/") || p.includes("\0")) throw new Error("Absolute or invalid paths are not allowed");
  const normalized = path.normalize(p);
  if (normalized.startsWith("..")) throw new Error("Path escapes repository root");
  return normalized;
}

/** Apply patches (content or diff) to files under destRoot. */
async function applyPatchesToDir(patches: PatchInput[], destRoot: string) {
  const applied: { path: string; wasCreated: boolean; previousContent: string | null }[] = [];
  for (const p of patches) {
    if (!p || typeof p.path !== "string") throw new Error("Invalid patch object");
    const rel = validateRelativePath(p.path);
    const abs = path.resolve(destRoot, rel);
    const parent = path.dirname(abs);
    await fs.mkdir(parent, { recursive: true });

    let current: string | null = null;
    try {
      current = await fs.readFile(abs, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") current = null;
      else throw err;
    }

    if (typeof p.content === "string") {
      await fs.writeFile(abs, p.content, "utf8");
      applied.push({ path: rel, wasCreated: current === null, previousContent: current });
      continue;
    } else if (typeof p.diff === "string") {
      const base = current ?? "";
      const patched = applyPatch(base, p.diff);
      if (patched === false || typeof patched !== "string") {
        throw new Error(`Failed to apply patch for ${p.path}`);
      }
      await fs.writeFile(abs, patched, "utf8");
      applied.push({ path: rel, wasCreated: current === null, previousContent: current });
      continue;
    } else {
      throw new Error(`Patch missing 'content' or 'diff' for ${p.path}`);
    }
  }
  return applied;
}

/**
 * runSandboxForPatches
 *
 * Copies the repo into a temp directory, applies patches, runs tests/typecheck/lint,
 * and returns structured results.
 */
export async function runSandboxForPatches(patches: PatchInput[], options: SandboxOptions = {}): Promise<SandboxResult> {
  const timeoutMs = options.timeoutMs ?? 60000;
  const maxOutputSize = options.maxOutputSize ?? 20000;
  const keepTemp = options.keepTemp ?? false;
  const env = options.env ?? {};

  let tmpDir: string | null = null;
  try {
    const prefix = path.join(os.tmpdir(), "repowriter-sandbox-");
    tmpDir = await fs.mkdtemp(prefix);

    if ((fs as any).cp) {
      // @ts-ignore
      await (fs as any).cp(REPO_PATH, tmpDir, { recursive: true });
    } else {
      const copyRecursive = async (src: string, dest: string) => {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const ent of entries) {
          const srcPath = path.join(src, ent.name);
          const destPath = path.join(dest, ent.name);
          if (ent.isDirectory()) {
            await copyRecursive(srcPath, destPath);
          } else if (ent.isFile()) {
            await fs.copyFile(srcPath, destPath);
          }
        }
      };
      await copyRecursive(REPO_PATH, tmpDir);
    }

    await applyPatchesToDir(patches, tmpDir);

    const results: SandboxResult = { ok: true, tempDir: keepTemp ? tmpDir : null, logs: "" };

    const testCmd = options.testCommand ?? "npm test";
    let typecheckCmd = options.typecheckCommand;
    let lintCmd = options.lintCommand;

    try {
      await fs.access(path.join(tmpDir, "tsconfig.json"));
      if (!typecheckCmd) typecheckCmd = "npm --prefix . run tsc --noEmit";
    } catch {}

    try {
      const pkgJsonRaw = await fs.readFile(path.join(tmpDir, "package.json"), "utf8");
      const pkg = JSON.parse(pkgJsonRaw);
      if (!lintCmd) {
        if (pkg.scripts && pkg.scripts.lint) {
          lintCmd = "npm run lint";
        } else {
          lintCmd = undefined;
        }
      }
    } catch {}

    if (typecheckCmd) {
      const res = await runCommand(typecheckCmd, tmpDir, { timeoutMs, env, maxOutputSize });
      results.typecheck = res;
      if (!res.ok) results.ok = false;
      results.logs += `typecheck: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
    }

    if (testCmd) {
      const res = await runCommand(testCmd, tmpDir, { timeoutMs, env, maxOutputSize });
      results.tests = res;
      if (!res.ok) results.ok = false;
      results.logs += `tests: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
    }

    if (lintCmd) {
      const res = await runCommand(lintCmd, tmpDir, { timeoutMs, env, maxOutputSize });
      results.lint = res;
      if (!res.ok) results.ok = false;
      results.logs += `lint: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
    }

    results.logs += `ok=${results.ok}\n`;
    if (!keepTemp) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        results.tempDir = null;
      } catch {
        // ignore cleanup errors
      }
    }

    return results;
  } catch (err: any) {
    const message = String(err?.message || err);
    const res: SandboxResult = {
      ok: false,
      error: message,
      tempDir: keepTemp ? tmpDir : null,
      logs: `error: ${message}`
    };
    return res;
  } finally {
    if (!options.keepTemp && tmpDir) {
      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// Backwards-compatible alias for validator/other callers
export async function runTestsInSandbox(patches: any[], options: any = {}) {
  return await runSandboxForPatches(patches, options);
}

export default { runSandboxForPatches, runTestsInSandbox };

