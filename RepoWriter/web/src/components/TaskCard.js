import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
function statusColor(status) {
    switch (status) {
        case "draft":
            return "var(--muted)";
        case "running":
            return "var(--color-primary)";
        case "validated":
            return "var(--highlight, var(--color-primary-light))";
        case "applied":
            return "var(--success)";
        case "failed":
            return "var(--danger)";
        case "rolledback":
            return "orange";
        default:
            return "var(--muted)";
    }
}
function shortDate(s) {
    if (!s)
        return "";
    try {
        const d = new Date(s);
        return d.toLocaleString();
    }
    catch {
        return s;
    }
}
export default function TaskCard({ task, onEdit, onRemove, onRun, onImport, onSave }) {
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [prompt, setPrompt] = useState(task.prompt);
    // show a short preview of the prompt (first line or 120 chars)
    const preview = useMemo(() => {
        const p = (task.prompt || "").trim().split("\n")[0] ?? "";
        if (p.length > 120)
            return p.slice(0, 117) + "...";
        return p;
    }, [task.prompt]);
    function handleSave() {
        if (onSave)
            onSave({ title: title.trim(), prompt: prompt.trim() });
        setEditing(false);
    }
    function handleCancel() {
        setTitle(task.title);
        setPrompt(task.prompt);
        setEditing(false);
    }
    return (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: _jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 10 }, children: [_jsx("div", { "aria-hidden": true, style: {
                        width: 10,
                        height: 10,
                        borderRadius: 12,
                        background: statusColor(task.status),
                        marginTop: 6,
                        flex: "0 0 auto"
                    }, title: `status: ${task.status}` }), _jsxs("div", { style: { flex: 1 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [!editing ? (_jsx("div", { style: { fontWeight: 700, color: "var(--text)", fontSize: 14 }, children: task.title })) : (_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), style: { flex: 1, padding: 6, borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)" } })), _jsxs("div", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("div", { style: { fontSize: 12, color: "var(--muted)" }, children: shortDate(task.updatedAt ?? task.createdAt) }), !editing && (_jsx("button", { onClick: () => setExpanded((s) => !s), title: "Toggle details", style: {
                                                border: "none",
                                                background: "transparent",
                                                color: "var(--muted)",
                                                padding: 6,
                                                borderRadius: 6,
                                                cursor: "pointer"
                                            }, children: expanded ? "▴" : "▾" }))] })] }), _jsx("div", { style: { marginTop: 8 }, children: !editing ? (_jsx("div", { style: { color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }, children: preview })) : (_jsx("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), style: { width: "100%", minHeight: 80, padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)" } })) }), expanded && (_jsxs("div", { style: { marginTop: 8, borderTop: "1px dashed rgba(255,255,255,0.03)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }, children: [_jsx("div", { style: { color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }, children: task.prompt }), task.plan ? (_jsxs("div", { style: { fontSize: 13, color: "var(--muted)" }, children: ["Plan: ", Array.isArray(task.plan.steps) ? `${task.plan.steps.length} step(s)` : "unknown"] })) : null, task.lastError ? (_jsx("div", { style: { color: "var(--danger)", fontSize: 13 }, children: task.lastError })) : null] })), _jsx("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: !editing ? (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => onRun?.(), style: {
                                            padding: "6px 12px",
                                            borderRadius: 8,
                                            border: "none",
                                            background: "var(--color-primary)",
                                            color: "#fff"
                                        }, title: "Run local planner for this task", children: "Run" }), _jsx("button", { onClick: () => onImport?.(), style: {
                                            padding: "6px 10px",
                                            borderRadius: 8,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "transparent",
                                            color: "var(--muted)"
                                        }, title: "Import validated plan into the Codex workspace", children: "Import" }), _jsx("button", { onClick: () => {
                                            setEditing(true);
                                            onEdit?.();
                                        }, style: {
                                            padding: "6px 10px",
                                            borderRadius: 8,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "transparent",
                                            color: "var(--muted)"
                                        }, title: "Edit task", children: "Edit" }), _jsx("button", { onClick: () => onRemove?.(), style: {
                                            marginLeft: "auto",
                                            padding: "6px 10px",
                                            borderRadius: 8,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "transparent",
                                            color: "var(--danger)"
                                        }, title: "Remove task", children: "Delete" })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { onClick: handleSave, style: {
                                            padding: "6px 12px",
                                            borderRadius: 8,
                                            border: "none",
                                            background: "var(--color-primary)",
                                            color: "#fff"
                                        }, children: "Save" }), _jsx("button", { onClick: handleCancel, style: {
                                            padding: "6px 10px",
                                            borderRadius: 8,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "transparent",
                                            color: "var(--muted)"
                                        }, children: "Cancel" })] })) })] })] }) }));
}
