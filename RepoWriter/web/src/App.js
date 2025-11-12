import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import axios from "axios";
const API = import.meta.env.VITE_API_URL;
export default function App() {
    const [prompt, setPrompt] = useState("");
    const [plan, setPlan] = useState(null);
    const [status, setStatus] = useState("");
    async function makePlan() {
        setStatus("planning...");
        const { data } = await axios.post(`${API}/api/openai/plan`, { prompt, memory: [] });
        setPlan(data.plan);
        setStatus("plan ready");
    }
    async function applyPlan() {
        if (!plan?.patches?.length)
            return;
        setStatus("applying...");
        const { data } = await axios.post(`${API}/api/openai/apply`, { patches: plan.patches, mode: "apply" });
        setStatus(`applied ${data.results?.length || 0} files`);
    }
    return (_jsxs("div", { style: { padding: 16, fontFamily: "sans-serif" }, children: [_jsx("h2", { children: "RepoWriter" }), _jsx("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "Describe what you want to change. Narrative allowed.", rows: 6, style: { width: "100%" } }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("button", { onClick: makePlan, children: "Plan" }), _jsx("button", { onClick: applyPlan, disabled: !plan, children: "Apply" })] }), _jsx("pre", { style: { whiteSpace: "pre-wrap", marginTop: 16 }, children: status }), _jsx("pre", { style: { background: "#111", color: "#0f0", padding: 8, overflowX: "auto" }, children: JSON.stringify(plan, null, 2) })] }));
}
