/**
 * validator.ts
 *
 * Lightweight wrapper that invokes the sandbox runner to validate patches (typecheck/tests/lint).
 */

import { logInfo, logError } from "../telemetry/logger";
import { runTestsInSandbox, SandboxOptions, SandboxResult, PatchInput } from "./sandboxRunner";

/**
 * validatePatches
 *
 * @param patches - array of patches { path, content?, diff? }
 * @param options - sandbox options (timeoutMs, testCommand, keepTemp, etc.)
 * @returns SandboxResult
 */
export async function validatePatches(patches: PatchInput[], options: SandboxOptions = {}): Promise<SandboxResult> {
  logInfo(`validator: starting validation (patches=${patches?.length ?? 0})`);
  try {
    const out = await runTestsInSandbox(patches, options);
    logInfo(`validator: finished ok=${out.ok} exitCode=${out.tests?.exitCode} timedOut=${out.tests?.timedOut}`);
    return out;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    logError(`validator: unexpected error`, { error: msg });
    return { ok: false, error: msg };
  }
}

export default { validatePatches };
