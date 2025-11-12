import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import DiffViewer from "./DiffViewer";
export default function ApplyModal({ open, onClose, patches, defaultMessage, onConfirm, busy, }) {
    const [commitMessage, setCommitMessage] = useState(defaultMessage ?? "");
    const [selectedIndex, setSelectedIndex] = useState(0);
    useEffect(() => {
        setCommitMessage(defaultMessage ?? "");
    }, [defaultMessage]);
    useEffect(() => {
        if (!open) {
            setSelectedIndex(0);
        }
    }, [open]);
    if (!open)
        return null;
    const selected = patches[selectedIndex];
    return (_jsx("div", { style: overlay, children: _jsxs("div", { style: modal, children: [_jsxs("div", { style: header, children: [_jsx("div", { style: { fontSize: 18, fontWeight: 700 }, children: "Apply changes" }), _jsx("div", { style: { marginLeft: "auto" }, children: _jsx("button", { onClick: onClose, style: closeBtn, children: "\u2715" }) })] }), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 12 }, children: [_jsxs("div", { style: { width: 320, borderRight: "1px solid #e6eef3", paddingRight: 12, overflowY: "auto", maxHeight: "60vh" }, children: [_jsx("div", { style: { marginBottom: 8, fontWeight: 700 }, children: "Files to change" }), patches.length === 0 ? (_jsx("div", { style: { color: "#64748b" }, children: "No patches" })) : (_jsx("ul", { style: { listStyle: "none", padding: 0, margin: 0 }, children: patches.map((p, i) => (_jsxs("li", { style: {
                                            padding: "8px 6px",
                                            borderRadius: 6,
                                            background: selectedIndex === i ? "#f8fafc" : "transparent",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                        }, onClick: () => setSelectedIndex(i), children: [_jsx("div", { style: { fontWeight: 700 }, children: p.path }), _jsx("div", { style: { marginLeft: "auto", fontSize: 12, color: "#64748b" }, children: p.content ? "content" : p.diff ? "diff" : "" })] }, `${p.path}-${i}`))) }))] }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }, children: _jsx("div", { style: { fontWeight: 700 }, children: selected?.path ?? "Preview" }) }), _jsx("div", { style: { border: "1px solid #e6eef3", borderRadius: 8, overflow: "hidden", background: "#0b0b0b" }, children: selected ? (selected.diff ? (_jsx(DiffViewer, { diff: selected.diff, height: "60vh" })) : selected.content ? (_jsxs("div", { style: { padding: 12 }, children: [_jsx("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 6 }, children: "New / replacement content" }), _jsx("div", { style: { border: "1px solid #e6eef3", borderRadius: 6, padding: 8, background: "#fff", color: "#0f172a" }, children: _jsx("pre", { style: { margin: 0, whiteSpace: "pre-wrap" }, children: selected.content }) })] })) : (_jsx("div", { style: { padding: 12 }, children: "No preview available" }))) : (_jsx("div", { style: { padding: 12 }, children: "No file selected" })) })] })] }), _jsxs("div", { style: { marginTop: 12, display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("input", { value: commitMessage, onChange: (e) => setCommitMessage(e.target.value), placeholder: "Commit message", style: { flex: 1, padding: 8, borderRadius: 8, border: "1px solid #e6eef3" } }), _jsx("button", { onClick: async () => {
                                try {
                                    await onConfirm(commitMessage);
                                }
                                catch {
                                    // swallow — parent should surface errors
                                }
                            }, disabled: busy, style: { padding: "8px 12px", borderRadius: 8, background: "#f59e0b", color: "#fff", border: "none", fontWeight: 700 }, children: busy ? "Applying…" : "Confirm Apply" }), _jsx("button", { onClick: onClose, style: { padding: "8px 12px", borderRadius: 8, border: "1px solid #e6eef3", background: "#fff" }, children: "Cancel" })] })] }) }));
}
/* Styles */
const overlay = {
    position: "fixed",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    background: "rgba(8,10,12,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
};
const modal = {
    width: "90%",
    maxWidth: 1000,
    background: "#fff",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 12px 40px rgba(20,30,40,0.18)",
};
const header = {
    display: "flex",
    alignItems: "center",
    gap: 12,
};
const closeBtn = {
    border: "none",
    background: "transparent",
    fontSize: 18,
    cursor: "pointer",
};
