/**
 * codex.ts
 *
 * Codex-style routes: plan, stream, apply, and validate (sandbox).
 *
 * Enhancements:
 *  - /api/context/build -> build server-side context for a prompt
 *  - /api/openai/plan -> builds context and calls planner (planEdits) with enriched prompt
 *  - /api/openai/stream -> streaming planner with context enrichment (SSE)
 *  - /api/openai/validate -> run sandbox runner on patches (guarded by sandboxGuard)
 *
 */
import { Router } from "express";
import { streamChat } from "../services/openaiStreamClient.js";
import { planEdits } from "../services/planner.js";
import { applyPatches } from "../services/patcher.js";
import contextProvider from "../services/contextProvider.js";
import { runSandboxForPatches } from "../services/sandboxRunner.js";
import convManager from "../services/conversationManager.js";
import sandboxGuard from "../middleware/sandboxGuard.js";
const r = Router();
/**
 * POST /api/context/build
 * Body: { prompt: string, options?: ContextOptions }
 * Returns { files, totalTokens }
 */
r.post("/context/build", async (req, res, next) => {
    try {
        const { prompt, options } = req.body || {};
        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ ok: false, error: "missing prompt" });
        }
        const ctx = await contextProvider.buildContext(prompt, options || {});
        res.json({ ok: true, files: ctx.files, totalTokens: ctx.totalTokens });
    }
    catch (e) {
        next(e);
    }
});
/**
 * Helper: embed context files into a compact prompt fragment.
 * We include path + summary + snippet for each file.
 */
function buildContextFragment(files) {
    const parts = files.map(f => {
        const s = f.summary ? f.summary : "";
        const sn = f.snippet ? f.snippet.split("\n").slice(0, 8).join("\\n") : "";
        return { path: f.path, summary: s, snippet: sn };
    });
    // JSON-encode short shape and wrap with markers to aid extraction
    return `\n\n--REPO_CONTEXT_START--\n${JSON.stringify({ files: parts })}\n--REPO_CONTEXT_END--\n\n`;
}
/**
 * POST /api/openai/stream
 * Body: { prompt: string, memory?: string[], contextOptions?: {}, conversationId?: string }
 * Streams model payloads as SSE (Server-Sent Events). Each `data:` event contains
 * the raw JSON payload emitted by OpenAI streaming responses (or the textual chunk).
 */
r.post("/stream", async (req, res, next) => {
    try {
        const { prompt, memory = [], contextOptions = {}, conversationId } = req.body;
        if (!prompt || typeof prompt !== "string")
            return res.status(400).json({ error: "missing prompt" });
        // Build context and enrich prompt (best-effort)
        let enrichedPrompt = prompt;
        try {
            const ctx = await contextProvider.buildContext(prompt, contextOptions || {});
            if (ctx && Array.isArray(ctx.files) && ctx.files.length > 0) {
                enrichedPrompt = `${prompt}\n\n[Repository context: summaries and snippets follow]${buildContextFragment(ctx.files)}`;
            }
        }
        catch {
            // ignore context errors and proceed with original prompt
        }
        const system = [
            "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
            "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
            "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
        ].join("\n");
        const userPayload = JSON.stringify({
            prompt: enrichedPrompt,
            memory,
            guidance: "Stream a structured JSON plan as you generate it."
        });
        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        // streamChat yields { raw } where raw is a string payload (usually JSON or JSON fragments)
        const iterator = streamChat(system, userPayload);
        (async () => {
            try {
                for await (const chunk of iterator) {
                    const safe = String(chunk.raw).replace(/\n/g, "\\n");
                    res.write(`data: ${safe}\n\n`);
                }
                // Signal done
                res.write(`data: [DONE]\n\n`);
                res.end();
            }
            catch (err) {
                const msg = String(err?.message || err);
                res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
                res.end();
            }
        })();
        // Optionally: create or append to conversation if conversationId provided (best-effort)
        try {
            if (conversationId) {
                convManager.addUserMessage(conversationId, prompt);
            }
        }
        catch {
            // ignore conv errors
        }
    }
    catch (e) {
        next(e);
    }
});
/**
 * POST /api/openai/plan
 * Body: { prompt: string, memory?: string[], contextOptions?: {}, conversationId?: string }
 *
 * Returns: { plan }
 */
r.post("/plan", async (req, res, next) => {
    try {
        const { prompt, memory = [], contextOptions = {}, conversationId } = req.body;
        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "missing prompt" });
        }
        // Build server-side context and add to prompt (compact)
        let workingPrompt = prompt;
        try {
            const ctx = await contextProvider.buildContext(prompt, contextOptions || {});
            if (ctx && ctx.files && ctx.files.length > 0) {
                workingPrompt = `${prompt}\n\n[Repository context: summaries and snippets follow]${buildContextFragment(ctx.files)}`;
            }
        }
        catch {
            // ignore context failures
        }
        // Record user message in conversation if requested
        try {
            if (conversationId)
                convManager.addUserMessage(conversationId, prompt);
        }
        catch {
            // ignore
        }
        const plan = await planEdits(workingPrompt, memory || []);
        // Attach plan meta about context (if any)
        try {
            // If plan.success and context was used, add meta
            // We already embedded context in prompt; include brief meta for UI
            // (This is optional and best-effort)
        }
        catch { }
        // Optionally record model message in conversation with brief explanation
        try {
            if (conversationId) {
                const expl = (plan.steps && plan.steps[0] && plan.steps[0].explanation) ? plan.steps[0].explanation : "Plan generated";
                convManager.addModelMessage(conversationId, JSON.stringify({ explanation: expl, meta: plan.meta || {} }));
            }
        }
        catch { }
        res.json({ plan });
    }
    catch (e) {
        next(e);
    }
});
/**
 * POST /api/openai/apply
 * Body: { patches: Array<{path,content?,diff?}>, mode?: "dry"|"apply", push?: boolean, pushOptions?: { branchName, commitMessage, pr?: boolean } }
 *
 * Applies patches via patcher.applyPatches and returns structured result including rollback metadata on successful apply.
 * Note: push/PR are handled by repo routes. Keep apply focused on file write + commit.
 */
r.post("/apply", async (req, res, next) => {
    try {
        const { patches, mode = "apply" } = req.body;
        if (!Array.isArray(patches)) {
            return res.status(400).json({ error: "missing or invalid patches array" });
        }
        const result = await applyPatches(patches, mode === "dry" ? "dry" : "apply");
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
/**
 * POST /api/openai/validate
 * Body: { patches: Array<{path,content?,diff?}>, options?: SandboxOptions }
 * Runs sandboxed validation (typecheck/tests/lint) on patches applied to a temporary copy of the repo.
 * Requires sandboxGuard middleware to allow execution (SANDBOX_ENABLED=1 or REPOWRITER_ALLOW_NO_KEY=1).
 */
r.post("/validate", sandboxGuard, async (req, res, next) => {
    try {
        const { patches, options = {} } = req.body || {};
        if (!Array.isArray(patches) || patches.length === 0) {
            return res.status(400).json({ ok: false, error: "missing patches array" });
        }
        // Run sandbox with provided options
        const result = await runSandboxForPatches(patches, options || {});
        return res.json({ ok: true, result });
    }
    catch (e) {
        next(e);
    }
});
export default r;
