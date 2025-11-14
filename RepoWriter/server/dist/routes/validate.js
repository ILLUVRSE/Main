/**
 * validate.ts
 *
 * Route that runs sandbox validation against a set of patches.
 *
 * POST /api/validate
 * Body: { patches: Array<{path,content?,diff?}>, options?: SandboxOptions }
 *
 * Note: guarded by sandboxGuard at the route mount site (or you can import it here
 * and use it directly). This file normalizes inputs (e.g., testCommand arrays) and
 * maps the SandboxResult shape into a simple response used by the UI.
 */
import { Router } from "express";
import sandboxGuard from "../middleware/sandboxGuard.js";
import validator from "../services/validator.js";
const r = Router();
/**
 * POST /api/validate
 */
r.post("/", sandboxGuard, async (req, res, next) => {
    try {
        const { patches, options = {} } = req.body || {};
        if (!Array.isArray(patches) || patches.length === 0) {
            return res.status(400).json({ ok: false, error: "missing patches array" });
        }
        // Normalize testCommand if the client passed an array (some clients may pass ["npm", "test"] or similar)
        // We will accept both string and array forms; for arrays we pick the first element if it's a single string command
        const normalizedOptions = { ...(options || {}) };
        if (Array.isArray(normalizedOptions.testCommand)) {
            // If the array looks like command + args, join into a single shell string. Otherwise pick the first string.
            try {
                const tc = normalizedOptions.testCommand;
                if (tc.length === 0) {
                    normalizedOptions.testCommand = undefined;
                }
                else if (tc.length === 1) {
                    normalizedOptions.testCommand = String(tc[0]);
                }
                else {
                    // join with space to make a shellable command, e.g. ["npm","test"] -> "npm test"
                    normalizedOptions.testCommand = tc.map((t) => String(t)).join(" ");
                }
            }
            catch {
                normalizedOptions.testCommand = undefined;
            }
        }
        // Run validation
        const result = await validator.validatePatches(patches, normalizedOptions);
        // Determine passed status: prefer result.ok, otherwise base on tests exit code
        const passed = !!result.ok && !!result.tests && result.tests.exitCode === 0 && !result.tests.timedOut;
        // Provide short flattened response expected by UI: extract test stdout/stderr/exitCode where available
        const stdout = result.tests?.stdout ?? "";
        const stderr = result.tests?.stderr ?? "";
        const exitCode = typeof result.tests?.exitCode === "number" ? result.tests.exitCode : null;
        return res.json({
            ok: true,
            result,
            passed,
            stdout,
            stderr,
            exitCode
        });
    }
    catch (err) {
        // Defensive catch
        const msg = String(err?.message ?? err);
        return res.status(500).json({ ok: false, error: msg });
    }
});
export default r;
