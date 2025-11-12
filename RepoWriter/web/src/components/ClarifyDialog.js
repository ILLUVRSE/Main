import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
export default function ClarifyDialog({ open, question, suggestions = [], onAnswer, onCancel, title = "Clarifying question" }) {
    const [answer, setAnswer] = useState("");
    const [selectedSuggestion, setSelectedSuggestion] = useState(null);
    useEffect(() => {
        if (open) {
            setAnswer("");
            setSelectedSuggestion(null);
        }
    }, [open, question]);
    useEffect(() => {
        if (selectedSuggestion !== null && suggestions[selectedSuggestion]) {
            setAnswer(suggestions[selectedSuggestion]);
        }
    }, [selectedSuggestion, suggestions]);
    if (!open)
        return null;
    return (_jsx("div", { style: {
            position: "fixed",
            left: 0, top: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000
        }, children: _jsxs("div", { style: {
                width: 740,
                maxWidth: "95%",
                background: "#fff",
                borderRadius: 8,
                padding: 16,
                boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
            }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 16, fontWeight: 700 }, children: title }), _jsx("div", { style: { fontSize: 13, color: "#666" }, children: _jsx("button", { onClick: () => onCancel?.(), style: { background: "transparent", border: "none", cursor: "pointer", color: "#888" }, children: "\u2715" }) })] }), _jsxs("div", { style: { marginBottom: 12, whiteSpace: "pre-wrap", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial", fontSize: 14 }, children: [_jsx("div", { style: { marginBottom: 8, color: "#222" }, children: question }), suggestions && suggestions.length > 0 && (_jsxs("div", { style: { marginTop: 8 }, children: [_jsx("div", { style: { fontSize: 13, color: "#444", marginBottom: 6 }, children: "Suggested answers" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: suggestions.map((s, i) => (_jsx("button", { onClick: () => setSelectedSuggestion(i), style: {
                                            padding: "6px 10px",
                                            borderRadius: 6,
                                            border: selectedSuggestion === i ? "1px solid #2563eb" : "1px solid #e6e6e6",
                                            background: selectedSuggestion === i ? "#eef4ff" : "#fafafa",
                                            cursor: "pointer",
                                            fontSize: 13
                                        }, children: s.length > 80 ? s.slice(0, 80) + "…" : s }, i))) })] }))] }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { style: { fontSize: 13, marginBottom: 6, color: "#333" }, children: "Your answer" }), _jsx("textarea", { value: answer, onChange: (e) => setAnswer(e.target.value), placeholder: "Type your answer here. Be concise.", rows: 6, style: { width: "100%", fontFamily: "monospace", fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid #e6e6e6" } })] }), _jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [_jsx("button", { onClick: () => {
                                setAnswer("");
                                setSelectedSuggestion(null);
                                onCancel?.();
                            }, style: { padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }, children: "Cancel" }), _jsx("button", { onClick: () => {
                                const final = (answer || "").trim();
                                if (!final)
                                    return;
                                onAnswer(final);
                            }, disabled: !answer || answer.trim().length === 0, style: { padding: "8px 14px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }, children: "Submit Answer" })] })] }) }));
}
