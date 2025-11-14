/**
 * auditLog.ts
 *
 * Simple append-only audit logger for RepoWriter.
 *
 * Writes newline-delimited JSON entries to:
 *   <REPOWRITER_DATA_DIR or REPO_PATH>/.repowriter/audit.log
 *
 * Each entry includes timestamp and the provided fields.
 *
 * Keep entries small and structured to make grepping/parsing easy.
 */
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { REPO_PATH } from "../config.js";
const REL_DIR = ".repowriter";
const AUDIT_FILENAME = "audit.log";
function getDataRoot() {
    const env = process.env.REPOWRITER_DATA_DIR;
    if (env && env.trim().length > 0) {
        return path.isAbsolute(env) ? env : path.resolve(REPO_PATH, env);
    }
    return REPO_PATH;
}
function auditFilePath() {
    return path.join(getDataRoot(), REL_DIR, AUDIT_FILENAME);
}
async function ensureAuditDir() {
    const dir = path.dirname(auditFilePath());
    await fs.mkdir(dir, { recursive: true });
}
function sha256Hex(input) {
    return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
/**
 * Append an audit entry. This is fire-and-forget in the sense we append atomically.
 * The function returns the entry that was written (with id/timestamp filled).
 */
export async function logAction(entry) {
    const now = new Date().toISOString();
    const id = entry.id || `audit-${sha256Hex((entry.promptHash || "") + now).slice(0, 12)}`;
    const e = {
        id,
        timestamp: now,
        user: entry.user ?? null,
        action: entry.action,
        promptHash: entry.promptHash ?? null,
        files: entry.files ?? null,
        branch: entry.branch ?? null,
        prUrl: entry.prUrl ?? null,
        tokenEstimate: typeof entry.tokenEstimate === "number" ? entry.tokenEstimate : null,
        // ok must be boolean | undefined to satisfy the AuditEntry type
        ok: typeof entry.ok === "boolean" ? entry.ok : undefined,
        meta: entry.meta ?? null
    };
    const line = JSON.stringify(e) + "\n";
    try {
        await ensureAuditDir();
        // append atomically
        await fs.appendFile(auditFilePath(), line, { encoding: "utf8" });
    }
    catch (err) {
        // Best-effort: emit server console warning but do not throw; callers should handle errors as needed.
        try {
            console.warn("[auditLog] failed to write audit entry:", String(err));
        }
        catch { }
    }
    return e;
}
/**
 * Read recent audit entries (most recent `limit` lines). Returns parsed objects.
 */
export async function readRecent(limit = 200) {
    try {
        const file = auditFilePath();
        const raw = await fs.readFile(file, "utf8");
        const lines = raw.split("\n").filter(Boolean);
        const slice = lines.slice(-limit);
        return slice.map(l => {
            try {
                return JSON.parse(l);
            }
            catch {
                return { raw: l };
            }
        });
    }
    catch {
        return [];
    }
}
export default { logAction, readRecent, auditFilePath };
