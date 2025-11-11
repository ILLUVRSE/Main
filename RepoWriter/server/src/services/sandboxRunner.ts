/**
 * sandboxRunner.ts
 *
 * Lightweight sandbox runner that:
 *  - creates an isolated temporary copy of the repository,
 *  - applies provided patches (content or unified diff),
 *  - runs a command (e.g., `npm test`) inside the sandbox with a timeout,
 *  - returns stdout/stderr/exit status and (optionally) removes the sandbox.
 *
 * This is intentionally conservative and not a full secure sandbox — for production
 * use prefer containers (Docker) or proper OS-level sandboxing. This module is
 * intended for fast local validation in CI/dev.
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

export type SandboxOptions = {
  timeoutMs?: number; // kill command after this many ms
  keepSandbox?: boolean; // keep temp dir for inspection
};

export type SandboxResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  exitCode?: number | null;
  sandboxPath?: string;
  error?: string;
};

/** Create a temporary copy of the repository. */
async function createSandboxCopy(): Promise<string> {
  const prefix = path.join(os.tmpdir(), "repowriter-sandbox-");
  const tmpDir = await fs.mkdtemp(prefix);

  // Prefer fs.cp if available (Node 16+). Fallback to a simple file copy loop if not.
  // Note: cp options { recursive: true, dereference: true } are helpful.
  // If fs.cp is not present, throw to avoid partial implementations on older nodes.
  // Caller can implement more robust copy logic or use Docker in that case.
  const anyFs: any = fs as any;
  if (typeof anyFs.cp === "function") {
    await anyFs.cp(REPO_PATH, tmpDir, { recursive: true, dereference: true });
    return tmpDir;
  } else {
    throw new Error("fs.cp not available on this Node runtime; please run sandbox in an environment with fs.cp or implement copy fallback.");
  }
}

/** Ensure repo-relative path is safe for sandbox and return absolute path inside sandbox. */
function sandboxAbsPath(sandboxRoot: string, relPath: string): string {
  if (!relPath || typeof relPath !== "string") throw new Error("Invalid path");
  if (relPath.includes("\0")) throw new Error("Invalid path (null byte)");
  if (path.isAbsolute(relPath)) throw new Error("Absolute paths are not allowed");
  const resolved = path.resolve(sandboxRoot, relPath);
  const sandboxRootResolved = path.resolve(sandboxRoot);
  if (resolved !== sandboxRootResolved && !resolved.startsWith(sandboxRootResolved + path.sep)) {
    throw new Error("Path escapes sandbox root");
  }
  return resolved;
}

/** Apply an array of patches into the sandbox copy. */
async function applyPatchesToSandbox(sandboxRoot: string, patches: PatchInput[]) {
  for (const p of patches) {
    const abs = sandboxAbsPath(sandboxRoot, p.path);
    const cur = await (async () => {
      try {
        return await fs.readFile(abs, "utf8");
      } catch (err: any) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
    })();

    if (typeof p.content === "string") {
      // create/replace
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, p.content, "utf8");
    } else if (typeof p.diff === "string") {
      const base = cur ?? "";
      const patched = applyPatch(base, p.diff);
      if (patched === false || typeof patched !== "string") {
        throw new Error(`Failed to apply patch for ${p.path}`);
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, patched, "utf8");
    } else {
      throw new Error(`Patch for ${p.path} missing 'content' or 'diff'`);
    }
  }
}

/** Run a command in the sandbox with a timeout, capturing stdout/stderr. */
function runCommandInSandbox(sandboxRoot: string, command: string, args: string[] = [], timeoutMs = 30000): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: sandboxRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;

    const onFinish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      resolve({
        ok: !timedOut && (code === 0),
        stdout,
        stderr,
        timedOut,
        exitCode: code
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
      // allow some time for process to terminate and emit its exit
      setTimeout(() => onFinish(null, null), 50);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err: any) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr,
        timedOut,
        exitCode: null,
        error: String(err?.message || err)
      });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      onFinish(code, signal);
    });
  });
}

/**
 * Public: runTestsInSandbox
 * - patches: optional patches to apply before running tests
 * - testCommand: array like ['npm','test'] or ['node','-e','...']
 * - opts: sandbox options (timeout/keep)
 */
export async function runTestsInSandbox(
  patches: PatchInput[] = [],
  testCommand: string[] = ["npm", "test"],
  opts: SandboxOptions = {}
): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const keepSandbox = !!opts.keepSandbox;
  let sandboxPath = "";

  try {
    sandboxPath = await createSandboxCopy();
    if (patches.length > 0) {
      await applyPatchesToSandbox(sandboxPath, patches);
    }

    // Ensure node_modules is available if testCommand needs it.
    // We opt not to auto-install dependencies here; prefer CI/dev to provision them.
    // If node_modules missing and command is `npm test`, the caller can decide to install.

    const [cmd, ...args] = testCommand;
    const res = await runCommandInSandbox(sandboxPath, cmd, args, timeoutMs);
    res.sandboxPath = sandboxPath;
    if (!keepSandbox) {
      try {
        await fs.rm(sandboxPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      res.sandboxPath = undefined;
    }
    return res;
  } catch (err: any) {
    // Attempt cleanup on failure
    if (sandboxPath && !opts.keepSandbox) {
      try {
        await fs.rm(sandboxPath, { recursive: true, force: true });
      } catch {}
    }
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      error: String(err?.message || err)
    };
  }
}

export default { runTestsInSandbox, runCommandInSandbox };

