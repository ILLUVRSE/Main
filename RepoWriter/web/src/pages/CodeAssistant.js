import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import PlanStream from "../components/PlanStream";
import DiffViewer from "../components/DiffViewer";
import Editor from "../components/Editor";
export default function CodeAssistant() {
    const [prompt, setPrompt] = useState("");
    const [memory, setMemory] = useState("");
    const [streamText, setStreamText] = useState("");
    const [plan, setPlan] = useState(null);
    const [parsingError, setParsingError] = useState(null);
    const [selectedStep, setSelectedStep] = useState(0);
    const [selectedPatchIndex, setSelectedPatchIndex] = useState(0);
    const [included, setIncluded] = useState({}); // key = `${stepIdx}:${patchIdx}`
    const [status, setStatus] = useState(null);
    const [applyResult, setApplyResult] = useState(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        // Reset selection if plan changes
        setSelectedStep(0);
        setSelectedPatchIndex(0);
        setIncluded({});
        setApplyResult(null);
        setParsingError(null);
    }, [plan]);
    function onChunk(chunk) {
        setStreamText((s) => s + chunk);
    }
    function onDone() {
        // Try parse the accumulated streamText into JSON plan
        try {
            const trimmed = streamText.trim();
            // The server sends JSON fragments; try to find a JSON object in the text
            const parsed = JSON.parse(trimmed);
            if (parsed && parsed.plan) {
                setPlan(parsed.plan);
            }
            else if (parsed && Array.isArray(parsed.steps)) {
                setPlan(parsed);
            }
            else {
                // maybe model returned the Plan directly
                setPlan(parsed);
            }
            setParsingError(null);
        }
        catch (err) {
            setParsingError("Failed to parse streamed output as JSON plan. You can copy the raw output and inspect.");
        }
    }
    async function fetchPlan() {
        setLoading(true);
        setStatus("Fetching plan...");
        setPlan(null);
        setStreamText("");
        setParsingError(null);
        setApplyResult(null);
        try {
            const res = await fetch("/api/openai/plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, memory: memory ? memory.split("\n").filter(Boolean) : [] }),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`Server ${res.status}: ${t}`);
            }
            const j = await res.json();
            const p = j.plan ?? j;
            setPlan(p);
            setStatus("Plan fetched");
        }
        catch (err) {
            setStatus(`Plan failed: ${String(err?.message || err)}`);
        }
        finally {
            setLoading(false);
        }
    }
    function toggleInclude(stepIdx, patchIdx) {
        const key = `${stepIdx}:${patchIdx}`;
        setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
    }
    function isIncluded(stepIdx, patchIdx) {
        const key = `${stepIdx}:${patchIdx}`;
        // default: include everything if not explicitly toggled off
        if (!(key in included))
            return true;
        return !!included[key];
    }
    function getSelectedPatch() {
        if (!plan || !plan.steps || plan.steps.length === 0)
            return null;
        const step = plan.steps[selectedStep];
        if (!step || !step.patches || step.patches.length === 0)
            return null;
        return step.patches[selectedPatchIndex] ?? null;
    }
    async function doApply(mode) {
        if (!plan) {
            setStatus("No plan to apply");
            return;
        }
        const patches = [];
        plan.steps.forEach((step, sIdx) => {
            (step.patches || []).forEach((p, pIdx) => {
                if (isIncluded(sIdx, pIdx)) {
                    patches.push(p);
                }
            });
        });
        if (patches.length === 0) {
            setStatus("No patches selected for apply");
            return;
        }
        setLoading(true);
        setStatus(mode === "dry" ? "Running dry-run..." : "Applying patches...");
        setApplyResult(null);
        try {
            const res = await fetch("/api/openai/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ patches, mode }),
            });
            const j = await res.json();
            setApplyResult(j);
            if (j.ok) {
                setStatus(mode === "dry" ? "Dry-run succeeded" : "Apply succeeded");
            }
            else {
                setStatus(`${mode} failed: ${j.errors ? j.errors.join("; ") : JSON.stringify(j)}`);
            }
        }
        catch (err) {
            setStatus(`Apply error: ${String(err?.message || err)}`);
        }
        finally {
            setLoading(false);
        }
    }
    function renderPlanOverview() {
        if (!plan)
            return _jsx("div", { children: "No plan yet \u2014 click Plan or use Stream." });
        return (_jsxs("div", { children: [_jsx("div", { style: { marginBottom: 8, fontWeight: 600 }, children: "Plan" }), plan.steps.map((step, sIdx) => (_jsxs("div", { style: { border: "1px solid #e6eef3", padding: 8, borderRadius: 6, marginBottom: 8 }, children: [_jsxs("div", { style: { fontWeight: 600 }, children: ["Step ", sIdx + 1, ": ", step.explanation] }), _jsx("div", { style: { marginTop: 8 }, children: step.patches && step.patches.length > 0 ? (_jsx("ul", { style: { listStyle: "none", padding: 0 }, children: step.patches.map((p, pIdx) => {
                                    const key = `${sIdx}:${pIdx}`;
                                    const patchLabel = p.path || `(patch ${pIdx})`;
                                    return (_jsxs("li", { style: {
                                            display: "flex",
                                            gap: 8,
                                            alignItems: "center",
                                            padding: 6,
                                            borderRadius: 4,
                                            background: selectedStep === sIdx && selectedPatchIndex === pIdx ? "#f1f5f9" : "transparent",
                                            cursor: "pointer",
                                        }, onClick: () => {
                                            setSelectedStep(sIdx);
                                            setSelectedPatchIndex(pIdx);
                                        }, children: [_jsx("input", { type: "checkbox", checked: isIncluded(sIdx, pIdx), onChange: () => toggleInclude(sIdx, pIdx) }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: 13, color: "#0f172a" }, children: patchLabel }), _jsx("div", { style: { fontSize: 12, color: "#64748b" }, children: p.content ? `content (${p.content.length} chars)` : p.diff ? "unified diff" : "unknown" })] })] }, key));
                                }) })) : (_jsx("div", { style: { color: "#64748b" }, children: "No patches in this step" })) })] }, sIdx)))] }));
    }
    const selectedPatch = getSelectedPatch();
    return (_jsxs("div", { style: { padding: 12, display: "grid", gridTemplateColumns: "1fr 480px", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Prompt" }), _jsx("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "Describe the code changes you want (e.g., 'Add a util/summarize.ts and tests that summarize top-level comments')", style: { width: "100%", minHeight: 120, padding: 8, borderRadius: 6, border: "1px solid #e6eef3" } }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("button", { onClick: fetchPlan, disabled: loading || !prompt.trim(), children: loading ? "Working…" : "Plan (sync)" }), " ", _jsx("span", { style: { marginLeft: 8, color: "#64748b" }, children: "Or stream with the Stream box below" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Stream Plan" }), _jsx(PlanStream, { prompt: prompt, memory: memory ? memory.split("\n").filter(Boolean) : [], onChunk: onChunk, onDone: onDone, onError: (err) => setStatus(String(err?.message || err)), startOnMount: false }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: "#334155", marginBottom: 6 }, children: "Raw stream output" }), _jsx("div", { style: { border: "1px solid #e6eef3", padding: 8, borderRadius: 6, minHeight: 80, whiteSpace: "pre-wrap" }, children: streamText || _jsx("span", { style: { color: "#94a3b8" }, children: "No streamed output" }) }), parsingError && _jsx("div", { style: { color: "#ef4444", marginTop: 6 }, children: parsingError })] })] }), _jsxs("div", { children: [_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("button", { onClick: () => doApply("dry"), disabled: loading || !plan, children: "Dry run selected" }), _jsx("button", { onClick: () => doApply("apply"), disabled: loading || !plan, children: "Apply selected" }), _jsx("div", { style: { marginLeft: "auto", color: "#64748b" }, children: status })] }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Plan Preview" }), renderPlanOverview()] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Apply Result" }), _jsx("div", { style: { border: "1px solid #e6eef3", padding: 8, borderRadius: 6, minHeight: 80, whiteSpace: "pre-wrap" }, children: applyResult ? _jsx("pre", { style: { margin: 0 }, children: JSON.stringify(applyResult, null, 2) }) : _jsx("span", { style: { color: "#94a3b8" }, children: "No apply result yet." }) })] })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Patch Preview" }), selectedPatch ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { marginBottom: 8, color: "#334155", fontWeight: 600 }, children: selectedPatch.path }), selectedPatch.diff ? (_jsx(DiffViewer, { diff: selectedPatch.diff, height: "360px" })) : selectedPatch.content ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 6 }, children: "New / replacement content" }), _jsx(Editor, { value: selectedPatch.content, language: "typescript", readOnly: true })] })) : (_jsx("div", { children: "No preview available for this patch" }))] })) : (_jsx("div", { style: { color: "#64748b" }, children: "Select a patch to preview" }))] }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Repo Browser" }), _jsxs("div", { style: { border: "1px solid #e6eef3", borderRadius: 6, padding: 8 }, children: [_jsx("a", { href: "/repo", style: { color: "#2563eb" }, children: "Open repo browser" }), _jsx("div", { style: { fontSize: 12, color: "#64748b", marginTop: 8 }, children: "Use the Repo Browser to inspect files and confirm patches before applying." })] })] })] })] }));
}
