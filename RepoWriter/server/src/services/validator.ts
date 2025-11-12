/**
 * validator.ts
 *
 * Lightweight wrapper to validate a set of patches by applying them in a sandbox copy
 * and running a test command. Delegates to sandboxRunner.runTestsInSandbox.
 *
 * Public API:
 *   validatePatches(patches, opts) -> Promise<SandboxResult>
 *
 * Where SandboxResult is the structure returned by sandboxRunner.runTestsInSandbox:
 *   { ok, stdout, stderr, timedOut?, exitCode?, sandboxPath?, error? }
 */

import { runTestsInSandbox } from "./sandboxRunner.js";
import { logInfo, logError } from "../telemetry/logger.js";

export type PatchInput = {
  path: string;
  content?: string;
  diff?: string;
};

export type ValidateOptions = {
  testCommand?: string[]; // e.g., ['npm', 'test']
  timeoutMs?: number;
  keepSandbox?: boolean;
};

export type ValidateResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  exitCode?: number | null;
  sandboxPath?: string | undefined;
  error?: string;
};

export async function validatePatches(patches: PatchInput[], opts: ValidateOptions = {}): Promise<ValidateResult> {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("validatePatches requires a non-empty patches array");
  }

  const testCommand = Array.isArray(opts.testCommand) && opts.testCommand.length > 0 ? opts.testCommand : ["npm", "test"];
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : undefined;
  const keepSandbox = !!opts.keepSandbox;

  logInfo(`validator: starting validation (patches=${patches.length})`, { testCommand, timeoutMs });

  try {
    const res = await runTestsInSandbox(patches as any, testCommand, { timeoutMs, keepSandbox });
    const out: ValidateResult = {
      ok: !!res.ok,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
      timedOut: !!res.timedOut,
      exitCode: typeof res.exitCode === "number" ? res.exitCode : null,
      sandboxPath: res.sandboxPath,
      error: res.error
    };
    logInfo(`validator: finished ok=${out.ok} exitCode=${out.exitCode} timedOut=${out.timedOut}`);
    return out;
  } catch (err: any) {
    logError(`validator: unexpected error`, { error: String(err?.message || err) });
    return {
      ok: false,
      stdout: "",
      stderr: "",
      timedOut: false,
      exitCode: null,
      error: String(err?.message || err)
    };
  }
}

export default { validatePatches };

