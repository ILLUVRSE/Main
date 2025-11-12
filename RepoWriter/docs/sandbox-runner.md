# Sandbox runner — design & usage

This document describes the sandbox runner used by RepoWriter to run **typechecks, tests, and linters** against patches in an isolated temporary workspace.

> **Important security note:** The current implementation is a pragmatic *host-based* runner that copies the repository to a temporary directory and runs the configured commands on the host. This is convenient for local development and CI, but **not suitable for untrusted inputs** or shared multi-tenant deployments. For production, run the sandbox inside a container or VM with strict resource and network restrictions.

## Goals

* Allow the planner/apply loop to validate changes by running `tsc`, `npm test`, and `lint` before applying changes to the real repository.
* Provide structured results (ok/failed, exit codes, truncated logs) to the caller so the UI or the planner can reason about failures.
* Provide a simple API so the UI can re-run validations and download logs.

## Location

* **Implementation:** `RepoWriter/server/src/services/sandboxRunner.ts`
* **Server route:** `POST /api/openai/validate` (see `RepoWriter/server/src/routes/codex.ts`)
* **Guard:** `server/src/middleware/sandboxGuard.ts` — sandbox endpoints are enabled only when `SANDBOX_ENABLED=1` (or `REPOWRITER_ALLOW_NO_KEY=1` in dev).

## How the runner works (host-based)

1. **Create temporary directory** — the runner creates a temp dir under the OS tmp folder.
2. **Copy repository** — it copies the repository at `REPO_PATH` into the temp directory (uses `fs.cp` when available; falls back to a recursive copy).
3. **Apply patches** — the runner writes files by applying each patch (supports `content` or unified `diff`).
4. **Run commands** — by default it runs (in this order):

   * `typecheck` (if `tsconfig.json` exists, runs `npm --prefix . run tsc --noEmit`)
   * `npm test`
   * `npm run lint` (if `lint` script exists)

   Each command has a per-command timeout and output truncation cap.
5. **Collect results** — stdout/stderr, exit codes, timedOut flag, and a short log summary are returned.
6. **Cleanup** — unless `keepTemp: true` is specified, the temp dir is removed.

## API schema & contract

* **Server endpoint:** `POST /api/openai/validate`

  * **Body:** `{ patches: Array<{path, content?, diff?}>, options?: SandboxOptions }`
  * Uses `sandboxGuard` to enforce SANDBOX_ENABLED or developer override.
  * **Response:** `{ ok: true, result: SandboxResult }` where `SandboxResult` shape is:

```ts
type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

type SandboxResult = {
  ok: boolean;
  tests?: CommandResult;
  typecheck?: CommandResult;
  lint?: CommandResult;
  error?: string;          // high-level error message on runner failure
  timedOut?: boolean;
  tempDir?: string | null; // returned only if keepTemp=true or on error
  logs?: string;           // short summary
};
```

* **SandboxOptions** (server accepts from client):

  * `timeoutMs?: number` — per-command timeout (default 60000ms)
  * `testCommand?: string` — command used to run tests (default `npm test`)
  * `typecheckCommand?: string` — override for typecheck command
  * `lintCommand?: string` — override for lint command
  * `keepTemp?: boolean` — if true, runner will not delete the temp directory (useful for debugging)
  * `maxOutputSize?: number` — max chars per command output (default 20000)
  * `env?: Record<string,string>` — env vars to pass to the commands

## Usage examples

* **Server route (internal):**

  ```bash
  curl -X POST http://localhost:7071/api/openai/validate \
    -H "Content-Type: application/json" \
    -d '{"patches":[{"path":"src/foo.ts","content":"export const x = 1\n"}],"options":{"timeoutMs":30000}}'
  ```

* **Client UI (example):** `web/src/components/ValidationResults.tsx` calls `api.validatePatches(...)`.

## Recommended production changes

To make sandboxing safe for untrusted inputs or public deployments:

* **Run each sandbox in a container** (Docker/Kata/Firecracker):

  * Create ephemeral container images with a minimal runtime.
  * Mount only the source files necessary and restrict network access.
  * Set CPU/memory/time quotas.
  * Copy patches into the container or mount a tarball.
* **Use read-only mounts for dependencies** and ensure node_modules is either reinstalled inside the container with strict timeouts or cached safely.
* **Audit logs & quotas** — log resource usage and enforce per-user quotas.
* **Scan for dangerous ops** — detect and block package scripts that run arbitrary installers or network installers.
* **Use ephemeral Git credentials** for push/PR flows rather than exposing long-lived tokens on the runner host.

## CI notes

* The provided workflow `.github/workflows/repowriter-validate.yml` sets `SANDBOX_ENABLED=1` and uses the host-based sandbox in CI. This is acceptable for CI because the runner environment is trusted and ephemeral. For external contributors, CI runs in GitHub-hosted runners so this is acceptable.

## Troubleshooting

* If you see `SANDBOX_ENABLED` warnings, ensure `SANDBOX_ENABLED=1` is set (or set `REPOWRITER_ALLOW_NO_KEY=1` for quick dev bypass).
* For debugging, set `keepTemp=true` in options and inspect the temp directory printed in the response.
* If your test command requires secrets or special env, pass them via `options.env` (but be mindful of leaking secrets).

