/**
 * validate.ts
 *
 * HTTP route to validate a set of patches by running them inside the sandbox runner.
 * Expects JSON body: { patches: Array<{ path, content?, diff? }>, testCommand?: string[], timeoutMs?: number }
 *
 * Returns:
 * {
 *   ok: boolean,
 *   passed: boolean,
 *   stdout?: string,
 *   stderr?: string,
 *   timedOut?: boolean,
 *   exitCode?: number | null,
 *   error?: string
 * }
 *
 * This route delegates to src/services/validator.ts which wraps sandboxRunner.
 */

import { Router, Request, Response, NextFunction } from "express";
import { validatePatches } from "../services/validator.js";
import { logInfo, logError } from "../telemetry/logger.js";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patches, testCommand, timeoutMs } = req.body as {
      patches?: Array<any>;
      testCommand?: string[];
      timeoutMs?: number;
    };

    if (!Array.isArray(patches) || patches.length === 0) {
      return res.status(400).json({ ok: false, error: "missing or empty patches array" });
    }

    logInfo(req, `validate: received ${patches.length} patch(es)`);

    const result = await validatePatches(patches, {
      testCommand: Array.isArray(testCommand) && testCommand.length > 0 ? testCommand : undefined,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined
    });

    // Normalize output
    const body: any = {
      ok: true,
      passed: !!result.ok && result.exitCode === 0 && !result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: !!result.timedOut,
      exitCode: typeof result.exitCode === "number" ? result.exitCode : null
    };

    if (result.error) {
      body.ok = false;
      body.error = result.error;
    }

    logInfo(req, `validate: result passed=${body.passed} timedOut=${body.timedOut} exitCode=${body.exitCode}`);

    return res.json(body);
  } catch (err: any) {
    logError(req, `validate: unexpected error`, { error: String(err?.message || err) });
    return next(err);
  }
});

export default router;

