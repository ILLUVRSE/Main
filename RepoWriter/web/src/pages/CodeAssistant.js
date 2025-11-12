import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import api from "../services/api";
import ContextSelector from "../components/ContextSelector";
import ValidationResults from "../components/ValidationResults";
import ClarifyDialog from "../components/ClarifyDialog";
export default function CodeAssistant() {
    const [prompt, setPrompt] = useState(""); // narrative prompt
    const [selectedContext, setSelectedContext] = useState([]);
    const [contextTokens, setContextTokens] = useState(0);
    const [plan, setPlan] = useState(null);
    const [streaming, setStreaming] = useState(false);
    const [streamLog, setStreamLog] = useState("");
    const [status, setStatus] = useState("");
    const [dryResult, setDryResult] = useState(null);
    const [appliedResult, setAppliedResult] = useState(null);
    const [validationResult, setValidationResult] = useState(null);
    const [showClarify, setShowClarify] = useState(false);
    const [clarifyQuestion, setClarifyQuestion] = useState("");
    const [clarifySuggestions, setClarifySuggestions] = useState([]);
    const [conversationId, setConversationId] = useState(null);
    useEffect(() => {
        // initialize (optional): create a conversation id if you want multi-turn
        setConversationId(`conv-${Date.now()}`);
    }, []);
    // Handler when ContextSelector changes
    function handleContextChange(selected, totalTokens) {
        setSelectedContext(selected || []);
        setContextTokens(totalTokens || 0);
    }
    // Build plan (non-streaming)
    async function handlePlan() {
        setStatus("Planning...");
        setPlan(null);
        setStreamLog("");
        try {
            // Try server-side context build first (recommended)
            const contextOpts = { topK: 8, tokenBudget: 1200 };
            // server will embed context automatically if we pass nothing here; include files by path in memory if desired
            const memory = [];
            // Fetch plan
            const p = await api.fetchPlan(prompt, memory, { backend: "openai" });
            setPlan(p);
            setStatus("Plan ready");
        }
        catch (err) {
            setStatus(`Plan failed: ${String(err?.message || err)}`);
        }
    }
    // Stream plan (SSE). Streams raw JSON fragments, we accumulate into streamLog and attempt to parse final JSON.
    async function handleStream() {
        setPlan(null);
        setStreamLog("");
        setStreaming(true);
        setStatus("Streaming plan...");
        try {
            await api.streamPlan(prompt, [], (chunk) => {
                // onChunk
                try {
                    // Some chunks are JSON fragments (escaped \n). Show them raw and append.
                    setStreamLog((s) => s + chunk);
                }
                catch {
                    setStreamLog((s) => s + chunk);
                }
            }, () => {
                setStreaming(false);
                setStatus("Streaming complete — attempt parsing plan");
                // Try parse streamLog as JSON
                try {
                    // The model may stream escaped JSON fragments; attempt to extract JSON
                    const parsed = tryExtractPlanFromStream(streamLog);
                    if (parsed) {
                        setPlan(parsed);
                        setStatus("Plan parsed from stream");
                    }
                    else {
                        setStatus("Could not parse streamed plan; check raw output");
                    }
                }
                catch (err) {
                    setStatus(`Stream parsing failed: ${String(err?.message || err)}`);
                }
            }, (err) => {
                setStreaming(false);
                setStatus(`Streaming error: ${String(err?.message || err)}`);
            }, { backend: "openai" });
        }
        catch (err) {
            setStreaming(false);
            setStatus(`Streaming call failed: ${String(err?.message || err)}`);
        }
    }
    // Helper to try to extract JSON plan from streaming raw text
    function tryExtractPlanFromStream(text) {
        if (!text)
            return null;
        const trimmed = text.trim();
        // If the stream contains escaped \n sequences, unescape them
        const replaced = trimmed.replace(/\\n/g, "\n");
        // Try direct parse
        try {
            return JSON.parse(replaced);
        }
        catch {
            // Try to find first { ... } substring
            const first = replaced.indexOf("{");
            const last = replaced.lastIndexOf("}");
            if (first !== -1 && last !== -1 && last > first) {
                const cand = replaced.slice(first, last + 1);
                try {
                    return JSON.parse(cand);
                }
                catch {
                    // fallback null
                    return null;
                }
            }
            return null;
        }
    }
    // Apply plan (either dry or apply)
    async function handleApply(mode) {
        setStatus(`${mode === "dry" ? "Dry-run" : "Applying"}...`);
        setDryResult(null);
        setAppliedResult(null);
        try {
            // Determine patches: use plan.patches if plan has patches; otherwise, ask user to provide patches
            const patches = gatherPatchesFromPlan(plan);
            if (!patches || patches.length === 0) {
                setStatus("No patches available to apply");
                return;
            }
            const res = await api.applyPatches(patches, mode);
            if (!res) {
                setStatus("Apply returned no result");
                return;
            }
            if (mode === "dry") {
                setDryResult(res);
                setStatus("Dry-run complete");
            }
            else {
                setAppliedResult(res);
                setStatus("Apply complete");
            }
        }
        catch (err) {
            setStatus(`Apply failed: ${String(err?.message || err)}`);
        }
    }
    // Validate patches via sandbox
    async function handleValidate() {
        setStatus("Validating...");
        setValidationResult(null);
        try {
            const patches = gatherPatchesFromPlan(plan);
            if (!patches || patches.length === 0) {
                setStatus("No patches to validate");
                return;
            }
            const res = await api.validatePatches(patches);
            setValidationResult(res);
            setStatus("Validation complete");
        }
        catch (err) {
            setStatus(`Validation failed: ${String(err?.message || err)}`);
        }
    }
    // Create PR: will apply patches (if needed), create branch, push and open PR via createPR
    async function handleCreatePR() {
        setStatus("Creating PR...");
        try {
            const patches = gatherPatchesFromPlan(plan);
            if (!patches || patches.length === 0) {
                setStatus("No patches to create PR from");
                return;
            }
            // Prompt for branch name & commit message (simple prompt)
            const branchName = `repowriter/${Date.now()}`;
            const commitMessage = `repowriter: apply ${patches.length} files`;
            const payload = {
                branchName,
                patches,
                commitMessage,
                prBase: "main",
                prTitle: commitMessage,
                prBody: `Automated changes applied by RepoWriter for prompt:\n\n${prompt}`
            };
            const res = await api.createPR(payload);
            setStatus("PR created");
            // Show result info
            setAppliedResult(res);
        }
        catch (err) {
            setStatus(`Create PR failed: ${String(err?.message || err)}`);
        }
    }
    // Gather patches from plan object
    function gatherPatchesFromPlan(p) {
        if (!p || !p.steps)
            return [];
        const patches = [];
        for (const s of p.steps) {
            if (!Array.isArray(s.patches))
                continue;
            for (const pa of s.patches) {
                if (pa && pa.path) {
                    const patch = { path: pa.path };
                    if (typeof pa.content === "string")
                        patch.content = pa.content;
                    if (typeof pa.diff === "string")
                        patch.diff = pa.diff;
                    patches.push(patch);
                }
            }
        }
        return patches;
    }
    // Handle Clarifying question flow (model -> user)
    function openClarify(question, suggestions = []) {
        setClarifyQuestion(question);
        setClarifySuggestions(suggestions);
        setShowClarify(true);
    }
    function onClarifyAnswer(answer) {
        // For simplicity, append answer to prompt and re-run plan
        setShowClarify(false);
        setPrompt((p) => `${p}\n\nClarification: ${answer}`);
        // optionally auto-run planner
        handlePlan();
    }
    // Render plan steps nicely
    function renderPlanSteps(p) {
        if (!p || !p.steps)
            return _jsx("div", { style: { color: "#666" }, children: "No plan" });
        return (_jsx("div", { children: p.steps.map((s, idx) => (_jsxs("div", { style: { marginBottom: 12, padding: 8, border: "1px solid #f0f0f0", borderRadius: 6 }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 6 }, children: ["Step ", idx + 1] }), _jsx("div", { style: { marginBottom: 6, color: "#333" }, children: s.explanation }), _jsx("div", { children: Array.isArray(s.patches) && s.patches.length > 0 ? (s.patches.map((pa, j) => (_jsxs("div", { style: { marginBottom: 8, background: "#fbfbfb", padding: 8, borderRadius: 4 }, children: [_jsx("div", { style: { fontFamily: "monospace", fontSize: 13 }, children: pa.path }), _jsx("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, marginTop: 6 }, children: pa.content ?? pa.diff ?? "" })] }, j)))) : (_jsx("div", { style: { color: "#777" }, children: "No patches for this step" })) })] }, idx))) }));
    }
    // UI layout
    return (_jsxs("div", { style: { display: "flex", gap: 12, padding: 16, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }, children: [_jsxs("div", { style: { width: 520 }, children: [_jsx("div", { style: { marginBottom: 8 }, children: _jsx("strong", { children: "Prompt" }) }), _jsx("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), rows: 8, placeholder: "Describe what you want to change. Narrative allowed. Example: 'Add a util/summarize.ts that summarizes top-level comments'", style: { width: "100%", fontFamily: "monospace", padding: 8, fontSize: 13, borderRadius: 6, border: "1px solid #e6e6e6" } }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("strong", { children: "Repository Context" }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(ContextSelector, { initialSelected: [], onChange: handleContextChange }) }), _jsxs("div", { style: { marginTop: 8, color: "#666", fontSize: 13 }, children: ["Context tokens estimate: ", contextTokens] })] }), _jsxs("div", { style: { marginTop: 12, display: "flex", gap: 8 }, children: [_jsx("button", { onClick: handlePlan, children: "Plan" }), _jsx("button", { onClick: handleStream, disabled: streaming, children: streaming ? "Streaming..." : "Stream" }), _jsx("button", { onClick: () => handleApply("dry"), disabled: !plan, children: "Dry-run" }), _jsx("button", { onClick: () => handleApply("apply"), disabled: !plan, children: "Apply" }), _jsx("button", { onClick: handleValidate, disabled: !plan, children: "Validate" }), _jsx("button", { onClick: handleCreatePR, disabled: !plan, children: "Create PR" })] }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "Status" }), _jsx("div", { style: { marginTop: 6, color: "#333" }, children: status })] })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Plan" }), _jsxs("div", { style: { border: "1px solid #eee", padding: 12, borderRadius: 6, maxHeight: "78vh", overflow: "auto", background: "#fff" }, children: [_jsx("div", { style: { marginBottom: 8 }, children: streamLog ? (_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 6 }, children: "Streamed raw output" }), _jsx("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, maxHeight: 220, overflow: "auto", background: "#111", color: "#0f0", padding: 8 }, children: streamLog })] })) : null }), _jsx("div", { style: { marginTop: 8 }, children: plan ? renderPlanSteps(plan) : _jsx("div", { style: { color: "#666" }, children: "No plan yet. Click Plan or Stream to generate a plan." }) })] })] }), _jsxs("div", { style: { width: 420 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Validation" }), _jsx(ValidationResults, { patches: gatherPatchesFromPlan(plan), autoRun: false, onComplete: (r) => setValidationResult(r) }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Applied / PR result" }), _jsx("div", { style: { background: "#fafafa", padding: 8, borderRadius: 6 }, children: _jsx("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }, children: JSON.stringify(appliedResult || {}, null, 2) }) })] })] }), _jsx(ClarifyDialog, { open: showClarify, question: clarifyQuestion, suggestions: clarifySuggestions, onAnswer: onClarifyAnswer, onCancel: () => setShowClarify(false) })] }));
}
