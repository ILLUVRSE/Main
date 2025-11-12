import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
/**
 * ApplyConfirmModal
 *
 * Simple confirmation modal that lists files to be changed, provides a commit message editor,
 * option to run dry/validate/apply, and shows a small rollback preview toggle.
 *
 * Styling is minimal and uses CSS variables from your theme.
 */
export default function ApplyConfirmModal({ open, title = "Confirm Apply", patches, onClose, onConfirm }) {
    const [commitMessage, setCommitMessage] = useState(() => {
        // default commit message derived from patches
        if (!patches || patches.length === 0)
            return "repowriter: apply";
        const single = patches.length === 1 ? ` ${patches[0].path}` : ` ${patches.length} files`;
        return `repowriter: apply${single}`;
    });
    const [saveRollback, setSaveRollback] = useState(true);
    const [mode, setMode] = useState("apply");
    const [showAllDiffs, setShowAllDiffs] = useState(false);
    // small content preview for each patch
    const previews = useMemo(() => {
        return patches.map((p) => {
            if (p.content) {
                const s = p.content.trim();
                const first = s.split("\n")[0];
                return first.length > 160 ? first.slice(0, 157) + "..." : first;
            }
            if (p.diff) {
                const first = p.diff.split("\n").slice(0, 6).join("\n");
                return first.length > 160 ? first.slice(0, 157) + "..." : first;
            }
            return "";
        });
    }, [patches]);
    if (!open)
        return null;
    return (_jsx("div", { role: "dialog", "aria-modal": true, style: {
            position: "fixed",
            left: 0,
            top: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(3,6,9,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: 20,
        }, onClick: () => onClose(), children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: {
                width: "min(1100px, 96%)",
                maxHeight: "90vh",
                overflow: "auto",
                borderRadius: 12,
                background: "var(--surface)",
                padding: 18,
                boxShadow: "0 10px 40px rgba(2,6,10,0.6)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("h3", { style: { margin: 0 }, children: title }), _jsxs("div", { style: { marginLeft: "auto", color: "var(--muted)", fontSize: 13 }, children: [patches.length, " patch", patches.length !== 1 ? "es" : ""] })] }), _jsxs("div", { style: { display: "flex", gap: 12 }, children: [_jsxs("div", { style: { flex: 1, minWidth: 300 }, children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 8 }, children: "Files to change" }), _jsx("div", { style: { display: "grid", gap: 8 }, children: patches.map((p, i) => (_jsxs("div", { style: {
                                            borderRadius: 8,
                                            padding: 8,
                                            background: "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(0,0,0,0.02))",
                                            border: "1px solid rgba(255,255,255,0.03)",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 6,
                                        }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("div", { style: { fontWeight: 700, color: "var(--text)" }, children: p.path }), _jsx("div", { style: { marginLeft: "auto", color: "var(--muted)", fontSize: 12 }, children: p.content ? "content" : p.diff ? "unified diff" : "unknown" })] }), _jsx("div", { style: { color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }, children: previews[i] || _jsx("span", { style: { color: "var(--muted)" }, children: "No preview available" }) })] }, i))) }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: showAllDiffs, onChange: (e) => setShowAllDiffs(e.target.checked) }), "Show full diffs/content inline"] }), showAllDiffs && (_jsx("div", { style: { marginTop: 8, display: "grid", gap: 8 }, children: patches.map((p, i) => (_jsx("pre", { style: {
                                                    background: "rgba(0,0,0,0.04)",
                                                    padding: 10,
                                                    borderRadius: 8,
                                                    overflowX: "auto",
                                                    whiteSpace: "pre-wrap",
                                                    fontSize: 13,
                                                    lineHeight: 1.4,
                                                }, children: p.diff ?? p.content ?? "(no preview)" }, i))) }))] })] }), _jsxs("div", { style: { width: 420, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 6 }, children: "Mode" }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { type: "radio", checked: mode === "apply", onChange: () => setMode("apply") }), _jsx("span", { children: "Apply" })] }), _jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { type: "radio", checked: mode === "dry", onChange: () => setMode("dry") }), _jsx("span", { children: "Dry-run" })] }), _jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { type: "radio", checked: mode === "validate", onChange: () => setMode("validate") }), _jsx("span", { children: "Validate" })] })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 6 }, children: "Commit message" }), _jsx("input", { value: commitMessage, onChange: (e) => setCommitMessage(e.target.value), style: { width: "100%", padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }, placeholder: "Commit message for apply" })] }), _jsxs("div", { children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: saveRollback, onChange: (e) => setSaveRollback(e.target.checked) }), _jsx("span", { children: "Save rollback metadata locally (recommended)" })] }), _jsx("div", { style: { marginTop: 6, fontSize: 12, color: "var(--muted)" }, children: "If checked, the UI will keep rollback metadata so you can restore changes later without searching logs." })] }), _jsxs("div", { style: { marginTop: "auto", display: "flex", gap: 8, justifyContent: "flex-end" }, children: [_jsx("button", { onClick: onClose, style: {
                                                padding: "8px 12px",
                                                borderRadius: 8,
                                                border: "1px solid rgba(0,0,0,0.06)",
                                                background: "transparent",
                                                color: "var(--muted)"
                                            }, children: "Cancel" }), _jsx("button", { onClick: () => {
                                                onConfirm({ mode, commitMessage: commitMessage || undefined, saveRollback });
                                            }, style: {
                                                padding: "8px 14px",
                                                borderRadius: 8,
                                                border: "none",
                                                background: mode === "apply" ? "var(--color-primary)" : "var(--color-primary-light)",
                                                color: "#fff",
                                                fontWeight: 700
                                            }, children: mode === "apply" ? "Apply" : mode === "dry" ? "Run Dry-run" : "Validate" })] })] })] })] }) }));
}
