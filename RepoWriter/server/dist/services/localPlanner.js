/**
 * localPlanner.ts
 *
 * Produce a structured plan using a local/offline LLM.
 *
 * This mirrors planner.ts but calls a local LLM (configured via LOCAL_LLM_URL)
 * instead of OpenAI. It attempts several common local-LLM endpoints and payload
 * shapes (OpenAI-compatible / text-generation-webui), and then normalizes the
 * returned text into a Plan object.
 *
 * Public API:
 *   localPlan(prompt: string, memory?: string[]) -> Promise<Plan>
 *
 * Notes:
 * - This duplicates a small amount of logic from planner.ts (normalizePlan)
 *   to remain self-contained. The normalize behavior matches planner.ts.
 * - The implementation is defensive: it tries multiple endpoints and heuristics
 *   to extract JSON from model output.
 */
import { REPO_PATH } from "../config.js";
const DEFAULT_LOCAL = "http://127.0.0.1:7860";
function getLocalBase() {
    return process.env.LOCAL_LLM_URL || DEFAULT_LOCAL;
}
/** Try to parse JSON from arbitrary text with simple heuristics */
function extractJsonFromText(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        // find outer-most JSON object braces
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            }
            catch {
                // continue
            }
        }
        // try array bracket
        const firstBracket = text.indexOf("[");
        const lastBracket = text.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            const cand = text.slice(firstBracket, lastBracket + 1);
            try {
                return JSON.parse(cand);
            }
            catch {
                // continue
            }
        }
        return null;
    }
}
/** Normalize arbitrary parsed JSON into Plan shape (copied from planner.ts) */
function normalizePlan(raw) {
    if (raw && typeof raw === "object" && Array.isArray(raw.steps)) {
        const steps = raw.steps.map((s) => {
            const explanation = String(s.explanation ?? "");
            const patches = Array.isArray(s.patches)
                ? s.patches.map((p) => ({
                    path: String(p.path ?? ""),
                    content: typeof p.content === "string" ? p.content : undefined,
                    diff: typeof p.diff === "string" ? p.diff : undefined
                }))
                : [];
            return { explanation, patches };
        });
        return { steps, meta: raw.meta ?? {} };
    }
    // fallback: couldn't parse structured steps
    return {
        steps: [
            {
                explanation: "Model output could not be parsed as a structured plan; see raw field.",
                patches: [
                    {
                        path: "",
                        content: `__raw_model_output__:\n${JSON.stringify(raw, null, 2)}`
                    }
                ]
            }
        ],
        meta: { unparsable: true }
    };
}
/** Try a local LLM endpoint (OpenAI-like chat/completions). Return { ok, text } */
async function tryOpenAIChat(base, prompt, model, temperature, max_tokens) {
    const url = `${base.replace(/\/$/, "")}/v1/chat/completions`;
    const body = {
        model: model ?? "gpt-4o-mini",
        temperature: typeof temperature === "number" ? temperature : 0.2,
        max_tokens: typeof max_tokens === "number" ? max_tokens : 512,
        messages: [{ role: "system", content: `You are RepoWriter's planning agent. Produce a JSON plan only.` }, { role: "user", content: prompt }]
    };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const text = await res.text();
        if (!res.ok) {
            return { ok: false, text, status: res.status };
        }
        // Try to extract text from common shapes
        try {
            const j = JSON.parse(text);
            const content = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? j?.text ?? text;
            return { ok: true, text: typeof content === "string" ? content : JSON.stringify(content) };
        }
        catch {
            return { ok: true, text };
        }
    }
    catch (err) {
        return { ok: false, text: String(err?.message || err) };
    }
}
/** Try text-generation / webui style endpoints (/generate, /api/generate) */
async function tryGeneratePaths(base, prompt, model, temperature, max_tokens) {
    const paths = ["/generate", "/api/generate", "/v1/generate"];
    for (const p of paths) {
        const url = `${base.replace(/\/$/, "")}${p}`;
        const body = {
            prompt,
            temperature: typeof temperature === "number" ? temperature : 0.2,
            max_new_tokens: typeof max_tokens === "number" ? max_tokens : 512,
            model
        };
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const text = await res.text();
            if (!res.ok)
                continue;
            try {
                const j = JSON.parse(text);
                const content = j?.text ?? j?.output ?? j?.results?.[0]?.text ?? text;
                return { ok: true, text: typeof content === "string" ? content : JSON.stringify(content) };
            }
            catch {
                return { ok: true, text };
            }
        }
        catch {
            // try next
        }
    }
    return { ok: false, text: "no generate endpoint responded" };
}
/**
 * Public: localPlan
 * - Builds an instructive system prefix (same contract as planner.ts)
 * - Attempts multiple local endpoints and parsing strategies
 * - Returns a normalized Plan object
 */
export async function localPlan(prompt, memory = [], opts = {}) {
    if (!prompt || typeof prompt !== "string") {
        throw new Error("prompt required");
    }
    // Build system instructions similar to planner
    const system = [
        "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
        "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
        `REPO_PATH: ${REPO_PATH}`,
        "Return only JSON or fragments that can be combined into JSON."
    ].join("\n\n");
    const combined = `${system}\n\nUser prompt:\n${prompt}\n\nMemory:\n${(memory || []).join("\n")}`;
    const base = getLocalBase();
    // 1) Try OpenAI-like chat completions
    const chatRes = await tryOpenAIChat(base, combined, opts.model, opts.temperature, opts.max_tokens);
    if (chatRes.ok) {
        // attempt parse
        const parsed = extractJsonFromText(chatRes.text);
        if (parsed)
            return normalizePlan(parsed);
        // otherwise attempt to parse free text as JSON
        try {
            return normalizePlan(JSON.parse(chatRes.text));
        }
        catch {
            // fallback to raw wrap
            return normalizePlan({ raw: chatRes.text });
        }
    }
    // 2) Try /generate style endpoints
    const genRes = await tryGeneratePaths(base, combined, opts.model, opts.temperature, opts.max_tokens);
    if (genRes.ok) {
        const parsed = extractJsonFromText(genRes.text);
        if (parsed)
            return normalizePlan(parsed);
        try {
            return normalizePlan(JSON.parse(genRes.text));
        }
        catch {
            return normalizePlan({ raw: genRes.text });
        }
    }
    // 3) Last-ditch: try fetching base (maybe returns helpful page)
    try {
        const check = await fetch(base);
        if (check.ok) {
            const txt = await check.text();
            return normalizePlan({ raw: txt });
        }
    }
    catch (err) {
        // ignore
    }
    // Nothing worked
    return {
        steps: [
            {
                explanation: "planner: local LLM call failed (unable to contact or parse output)",
                patches: []
            }
        ],
        meta: { error: true }
    };
}
export default { localPlan };
