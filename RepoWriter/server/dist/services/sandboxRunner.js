/**
 * sandboxRunner.ts
 *
 * Lightweight sandbox runner for RepoWriter.
 *
 * NOTE: This implementation now defaults to running commands inside a Docker
 * container for isolation. To use the legacy host-based runner, set
 * SANDBOX_RUNTIME=host (not recommended for production).
 *
 * This version also enforces a repowriter_allowlist.json allowlist (repo root)
 * so patches touching forbidden paths will be rejected.
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { applyPatch } from "diff";
import { REPO_PATH } from "../config.js";
/** HOST-based runCommand: the original behavior (kept for explicit dev use only). */
async function runCommandHost(cmd, cwd, opts = { timeoutMs: 60000 }) {
    return new Promise((resolve) => {
        const env = Object.assign({}, process.env, opts.env || {});
        const child = spawn(cmd, { cwd, shell: true, env });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let finished = false;
        const maxSize = opts.maxOutputSize ?? 20000;
        const cleanupAndResolve = (code) => {
            if (finished)
                return;
            finished = true;
            if (stdout.length > maxSize)
                stdout = stdout.slice(0, maxSize) + "\n...[truncated stdout]";
            if (stderr.length > maxSize)
                stderr = stderr.slice(0, maxSize) + "\n...[truncated stderr]";
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
            try {
                child.kill("SIGKILL");
            }
            catch { }
        }, opts.timeoutMs);
        child.stdout?.on("data", (b) => { stdout += b.toString(); });
        child.stderr?.on("data", (b) => { stderr += b.toString(); });
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
/** Docker-based runner for isolation (default). */
async function runCommandInDocker(cmd, cwd, opts = { timeoutMs: 60000 }) {
    return new Promise((resolve) => {
        const timeoutMs = opts.timeoutMs || 60000;
        const maxSize = opts.maxOutputSize ?? 20000;
        const envObj = Object.assign({}, process.env, opts.env || {});
        // Image may be provided via SANDBOX_DOCKER_IMAGE, otherwise use a default
        const dockerImage = process.env.SANDBOX_DOCKER_IMAGE || "repowriter-sandbox:latest";
        // Build docker args
        const dockerArgs = [
            "run", "--rm",
            "--network", "none",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--memory", "512m", "--cpus", "1.0",
            "-v", `${cwd}:/work:rw`,
            dockerImage,
            "bash", "-lc", cmd
        ];
        // spawn docker directly
        const child = spawn("docker", dockerArgs, { shell: false, env: envObj });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let finished = false;
        const cleanupAndResolve = (code) => {
            if (finished)
                return;
            finished = true;
            if (stdout.length > maxSize)
                stdout = stdout.slice(0, maxSize) + "\n...[truncated stdout]";
            if (stderr.length > maxSize)
                stderr = stderr.slice(0, maxSize) + "\n...[truncated stderr]";
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
            try {
                child.kill("SIGKILL");
            }
            catch { }
        }, timeoutMs);
        child.stdout?.on("data", (b) => { stdout += b.toString(); });
        child.stderr?.on("data", (b) => { stderr += b.toString(); });
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
/** Unified runCommand: defaults to Docker unless SANDBOX_RUNTIME=host. */
async function runCommand(cmd, cwd, opts = { timeoutMs: 60000 }) {
    const runtime = (process.env.SANDBOX_RUNTIME || "docker").toLowerCase();
    if (runtime === "host") {
        // Host execution allowed only when explicitly configured (dev)
        return runCommandHost(cmd, cwd, opts);
    }
    else {
        // Docker is the default and recommended runtime
        return runCommandInDocker(cmd, cwd, opts);
    }
}
/** Ensure a path is safe relative path (no traversal) */
function validateRelativePath(p) {
    if (!p || typeof p !== "string")
        throw new Error("Invalid path");
    if (p.startsWith("/") || p.includes("\0"))
        throw new Error("Absolute or invalid paths are not allowed");
    const normalized = path.normalize(p);
    if (normalized.startsWith(".."))
        throw new Error("Path escapes repository root");
    return normalized;
}
/** Load and parse repowriter_allowlist.json from repo root (best-effort). */
const ALLOWLIST_FILE = path.join(REPO_PATH, "repowriter_allowlist.json");
async function loadAllowlist() {
    try {
        const raw = await fs.readFile(ALLOWLIST_FILE, "utf8");
        const parsed = JSON.parse(raw);
        // normalize arrays
        parsed.allowed_paths = Array.isArray(parsed.allowed_paths) ? parsed.allowed_paths : [];
        parsed.forbidden_paths = Array.isArray(parsed.forbidden_paths) ? parsed.forbidden_paths : [];
        return parsed;
    }
    catch (err) {
        // If missing or invalid, return safe-empty config (very conservative will reject non-allowed paths below)
        return { allowed_paths: [], forbidden_paths: [] };
    }
}
/** Apply patches (content or diff) to files under destRoot. Enforces allowlist. */
async function applyPatchesToDir(patches, destRoot) {
    const applied = [];
    const allow = await loadAllowlist();
    for (const p of patches) {
        if (!p || typeof p.path !== "string")
            throw new Error("Invalid patch object");
        const rel = validateRelativePath(p.path);
        // Enforce forbidden paths
        for (const forb of (allow.forbidden_paths || [])) {
            if (!forb)
                continue;
            const nf = path.normalize(forb);
            if (rel === nf || rel.startsWith(nf + "/")) {
                throw new Error(`Patch touches forbidden path: ${rel}`);
            }
        }
        // Require allowed prefix if any allowed_paths are defined
        if (Array.isArray(allow.allowed_paths) && allow.allowed_paths.length > 0) {
            let ok = false;
            for (const pref of allow.allowed_paths) {
                if (!pref)
                    continue;
                const np = path.normalize(pref);
                if (rel === np || rel.startsWith(np)) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                throw new Error(`Patch touches disallowed/suspicious path: ${rel}`);
            }
        }
        const abs = path.resolve(destRoot, rel);
        const parent = path.dirname(abs);
        await fs.mkdir(parent, { recursive: true });
        let current = null;
        try {
            current = await fs.readFile(abs, "utf8");
        }
        catch (err) {
            if (err?.code === "ENOENT")
                current = null;
            else
                throw err;
        }
        if (typeof p.content === "string") {
            await fs.writeFile(abs, p.content, "utf8");
            applied.push({ path: rel, wasCreated: current === null, previousContent: current });
            continue;
        }
        else if (typeof p.diff === "string") {
            const base = current ?? "";
            const patched = applyPatch(base, p.diff);
            if (patched === false || typeof patched !== "string") {
                throw new Error(`Failed to apply patch for ${p.path}`);
            }
            await fs.writeFile(abs, patched, "utf8");
            applied.push({ path: rel, wasCreated: current === null, previousContent: current });
            continue;
        }
        else {
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
export async function runSandboxForPatches(patches, options = {}) {
    const timeoutMs = options.timeoutMs ?? 60000;
    const maxOutputSize = options.maxOutputSize ?? 20000;
    const keepTemp = options.keepTemp ?? false;
    const env = options.env ?? {};
    let tmpDir = null;
    try {
        const prefix = path.join(os.tmpdir(), "repowriter-sandbox-");
        tmpDir = await fs.mkdtemp(prefix);
        if (fs.cp) {
            // @ts-ignore
            await fs.cp(REPO_PATH, tmpDir, { recursive: true });
        }
        else {
            const copyRecursive = async (src, dest) => {
                await fs.mkdir(dest, { recursive: true });
                const entries = await fs.readdir(src, { withFileTypes: true });
                for (const ent of entries) {
                    const srcPath = path.join(src, ent.name);
                    const destPath = path.join(dest, ent.name);
                    if (ent.isDirectory()) {
                        await copyRecursive(srcPath, destPath);
                    }
                    else if (ent.isFile()) {
                        await fs.copyFile(srcPath, destPath);
                    }
                }
            };
            await copyRecursive(REPO_PATH, tmpDir);
        }
        await applyPatchesToDir(patches, tmpDir);
        const results = { ok: true, tempDir: keepTemp ? tmpDir : null, logs: "" };
        const testCmd = options.testCommand ?? "npm test";
        let typecheckCmd = options.typecheckCommand;
        let lintCmd = options.lintCommand;
        try {
            await fs.access(path.join(tmpDir, "tsconfig.json"));
            if (!typecheckCmd)
                typecheckCmd = "npm --prefix . run tsc --noEmit";
        }
        catch { }
        try {
            const pkgJsonRaw = await fs.readFile(path.join(tmpDir, "package.json"), "utf8");
            const pkg = JSON.parse(pkgJsonRaw);
            if (!lintCmd) {
                if (pkg.scripts && pkg.scripts.lint) {
                    lintCmd = "npm run lint";
                }
                else {
                    lintCmd = undefined;
                }
            }
        }
        catch { }
        if (typecheckCmd) {
            const res = await runCommand(typecheckCmd, tmpDir, { timeoutMs, env, maxOutputSize });
            results.typecheck = res;
            if (!res.ok)
                results.ok = false;
            results.logs += `typecheck: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
        }
        if (testCmd) {
            const res = await runCommand(testCmd, tmpDir, { timeoutMs, env, maxOutputSize });
            results.tests = res;
            if (!res.ok)
                results.ok = false;
            results.logs += `tests: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
        }
        if (lintCmd) {
            const res = await runCommand(lintCmd, tmpDir, { timeoutMs, env, maxOutputSize });
            results.lint = res;
            if (!res.ok)
                results.ok = false;
            results.logs += `lint: exit=${res.exitCode} timedOut=${res.timedOut}\n`;
        }
        results.logs += `ok=${results.ok}\n`;
        if (!keepTemp) {
            try {
                await fs.rm(tmpDir, { recursive: true, force: true });
                results.tempDir = null;
            }
            catch {
                // ignore cleanup errors
            }
        }
        return results;
    }
    catch (err) {
        const message = String(err?.message || err);
        const res = {
            ok: false,
            error: message,
            tempDir: keepTemp ? tmpDir : null,
            logs: `error: ${message}`
        };
        return res;
    }
    finally {
        if (!options.keepTemp && tmpDir) {
            try {
                await fs.rm(tmpDir, { recursive: true, force: true });
            }
            catch { }
        }
    }
}
// Backwards-compatible alias for validator/other callers
export async function runTestsInSandbox(patches, options = {}) {
    return await runSandboxForPatches(patches, options);
}
export default { runSandboxForPatches, runTestsInSandbox };
