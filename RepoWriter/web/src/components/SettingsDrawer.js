import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const LS_KEYS = {
    backend: "repowriter_backend",
    openaiKey: "repowriter_openai_key",
    openaiModel: "repowriter_openai_model",
    localUrl: "repowriter_local_url",
    localModel: "repowriter_local_model"
};
export default function SettingsDrawer() {
    const [open, setOpen] = useState(false);
    const [backend, setBackend] = useState(() => localStorage.getItem(LS_KEYS.backend) || "openai");
    const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem(LS_KEYS.openaiKey) ?? "");
    const [openaiModel, setOpenaiModel] = useState(() => localStorage.getItem(LS_KEYS.openaiModel) ?? "gpt-4o-mini");
    const [localUrl, setLocalUrl] = useState(() => localStorage.getItem(LS_KEYS.localUrl) ?? "http://127.0.0.1:7860");
    const [localModel, setLocalModel] = useState(() => localStorage.getItem(LS_KEYS.localModel) ?? "local-gpt");
    useEffect(() => {
        // persist and broadcast
        localStorage.setItem(LS_KEYS.backend, backend);
        localStorage.setItem(LS_KEYS.openaiKey, openaiKey);
        localStorage.setItem(LS_KEYS.openaiModel, openaiModel);
        localStorage.setItem(LS_KEYS.localUrl, localUrl);
        localStorage.setItem(LS_KEYS.localModel, localModel);
        const detail = { backend, openaiKey: openaiKey || null, openaiModel, localUrl, localModel };
        window.dispatchEvent(new CustomEvent("repowriter:settingsChanged", { detail }));
    }, [backend, openaiKey, openaiModel, localUrl, localModel]);
    return (_jsxs(_Fragment, { children: [_jsx("button", { title: "Settings", onClick: () => setOpen(true), style: {
                    border: "none",
                    background: "transparent",
                    color: "var(--muted)",
                    padding: 8,
                    cursor: "pointer"
                }, children: "\u2699\uFE0E" }), open && (_jsxs("div", { role: "dialog", "aria-modal": "true", style: {
                    position: "fixed",
                    right: 16,
                    top: 64,
                    width: 420,
                    maxWidth: "calc(100% - 32px)",
                    height: "calc(100% - 96px)",
                    background: "var(--surface)",
                    boxShadow: "0 8px 32px rgba(10,12,14,0.6)",
                    borderRadius: 12,
                    padding: 16,
                    zIndex: 1200,
                    overflowY: "auto"
                }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("h3", { style: { margin: 0 }, children: "Settings" }), _jsx("div", { style: { marginLeft: "auto", display: "flex", gap: 8 }, children: _jsx("button", { onClick: () => setOpen(false), style: {
                                        background: "transparent",
                                        border: "none",
                                        color: "var(--muted)",
                                        cursor: "pointer"
                                    }, children: "Close" }) })] }), _jsxs("section", { style: { marginTop: 12 }, children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 8 }, children: "Backend" }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { type: "radio", checked: backend === "openai", onChange: () => setBackend("openai") }), _jsx("span", { children: "OpenAI" })] }), _jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { type: "radio", checked: backend === "local", onChange: () => setBackend("local") }), _jsx("span", { children: "Local LLM" })] })] })] }), backend === "openai" ? (_jsxs("section", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 8 }, children: "OpenAI" }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("input", { placeholder: "OpenAI API Key (optional)", value: openaiKey, onChange: (e) => setOpenaiKey(e.target.value), style: { padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" } }), _jsx("label", { style: { fontSize: 13, color: "var(--muted)" }, children: "Model" }), _jsxs("select", { value: openaiModel, onChange: (e) => setOpenaiModel(e.target.value), style: { padding: 8, borderRadius: 8 }, children: [_jsx("option", { value: "gpt-4o-mini", children: "gpt-4o-mini" }), _jsx("option", { value: "gpt-4o", children: "gpt-4o" }), _jsx("option", { value: "gpt-4o-mini-1", children: "gpt-4o-mini-1" })] }), _jsx("div", { style: { fontSize: 12, color: "var(--muted)" }, children: "Tip: If API key is blank the server-side OPENAI_API_KEY will be used." })] })] })) : (_jsxs("section", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 8 }, children: "Local LLM" }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("input", { placeholder: "Local LLM URL (e.g., http://127.0.0.1:7860)", value: localUrl, onChange: (e) => setLocalUrl(e.target.value), style: { padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" } }), _jsx("label", { style: { fontSize: 13, color: "var(--muted)" }, children: "Local Model" }), _jsx("input", { placeholder: "Model name / config for local server", value: localModel, onChange: (e) => setLocalModel(e.target.value), style: { padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" } }), _jsx("div", { style: { fontSize: 12, color: "var(--muted)" }, children: "Tip: Set your local server URL and model. The server will proxy requests to this endpoint." })] })] })), _jsx("section", { style: { marginTop: 18 }, children: _jsxs("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" }, children: [_jsx("button", { onClick: () => {
                                        // reset to saved
                                        setBackend(localStorage.getItem(LS_KEYS.backend) || "openai");
                                        setOpenaiKey(localStorage.getItem(LS_KEYS.openaiKey) ?? "");
                                        setOpenaiModel(localStorage.getItem(LS_KEYS.openaiModel) ?? "gpt-4o-mini");
                                        setLocalUrl(localStorage.getItem(LS_KEYS.localUrl) ?? "http://127.0.0.1:7860");
                                        setLocalModel(localStorage.getItem(LS_KEYS.localModel) ?? "local-gpt");
                                    }, style: {
                                        padding: "6px 12px",
                                        borderRadius: 8,
                                        border: "1px solid rgba(0,0,0,0.06)",
                                        background: "transparent",
                                        color: "var(--muted)"
                                    }, children: "Reset" }), _jsx("button", { onClick: () => {
                                        // Save done via useEffect — just close drawer
                                        setOpen(false);
                                    }, style: {
                                        padding: "6px 12px",
                                        borderRadius: 8,
                                        border: "none",
                                        background: "var(--color-primary)",
                                        color: "#fff"
                                    }, children: "Save & Close" })] }) })] }))] }));
}
