/**
 * history.ts
 *
 * Routes to inspect recent `repowriter:` commits and to request rollback.
 *
 * GET  /        -> { commits: [{ sha, date, author_name, message }] }
 * POST /rollback
 *   Body: { commitSha?: string, rollbackMetadata?: { previousContents: Record<string,string|null> } }
 *   -> { ok: boolean, message?: string, error?: string }
 *
 * This route delegates actual rollback work to src/services/rollback.ts.
 */
import { Router } from "express";
import simpleGit from "simple-git";
import { REPO_PATH } from "../config.js";
import { logInfo, logError } from "../telemetry/logger.js";
import rollbackService from "../services/rollback.js";
const router = Router();
const git = simpleGit(REPO_PATH);
router.get("/", async (_req, res, next) => {
    try {
        // Get recent commits (limit reasonable)
        const log = await git.log({ maxCount: 100 });
        // Filter commits created by repowriter (message prefix)
        const repowriterCommits = (log.all || []).filter((c) => typeof c.message === "string" && c.message.startsWith("repowriter:"));
        const mapped = repowriterCommits.map((c) => ({
            sha: c.hash,
            date: c.date,
            author_name: c.author_name,
            author_email: c.author_email,
            message: c.message
        }));
        return res.json({ commits: mapped });
    }
    catch (err) {
        logError(`history:get failed: ${String(err?.message || err)}`);
        return next(err);
    }
});
router.post("/rollback", async (req, res, next) => {
    try {
        const { commitSha, rollbackMetadata } = req.body;
        if (!commitSha && !rollbackMetadata) {
            return res.status(400).json({ ok: false, error: "Missing commitSha or rollbackMetadata" });
        }
        logInfo(req, `history: rollback requested commitSha=${commitSha ? commitSha : "[metadata]"} `);
        if (commitSha) {
            // Ask rollback service to rollback the repository to the commit before commitSha
            const r = await rollbackService.rollbackCommit(commitSha);
            if (r.ok) {
                return res.json({ ok: true, message: `Rolled back commit ${commitSha}` });
            }
            else {
                return res.status(500).json({ ok: false, error: r.error || "rollback failed" });
            }
        }
        // Use rollbackMetadata path (apply previousContents)
        if (rollbackMetadata) {
            const r = await rollbackService.applyRollbackMetadata(rollbackMetadata);
            if (r.ok) {
                return res.json({ ok: true, message: "Applied rollback metadata" });
            }
            else {
                return res.status(500).json({ ok: false, error: r.error || "rollback metadata apply failed" });
            }
        }
        return res.status(400).json({ ok: false, error: "Unrecognized rollback request" });
    }
    catch (err) {
        logError(req, `history: rollback unexpected error`, { error: String(err?.message || err) });
        return next(err);
    }
});
export default router;
