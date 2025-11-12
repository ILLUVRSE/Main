import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
/**
 * PlanToolbar
 *
 * Compact toolbar used above the prompt area.
 * Exposes Plan/Stream/Dry-run/Apply/Validate controls and a small commit message input.
 *
 * Note: The toolbar is logic-light — it calls callbacks provided via props.
 * Keep UI state here (commit message, loading flags, streaming indicator).
 */
export default function PlanToolbar({ onPlan, onStream, onDryRun, onApply, onValidate, disabled = false, initialCommitMessage = "", status = null }) {
    const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
    const [busy, setBusy] = useState(false);
    const [streaming, setStreaming] = useState(false);
    async function handlePlan() {
        if (!onPlan)
            return;
        try {
            setBusy(true);
            await onPlan();
        }
        finally {
            setBusy(false);
        }
    }
    async function handleStream() {
        if (!onStream)
            return;
        try {
            setStreaming(true);
            await onStream();
        }
        finally {
            setStreaming(false);
        }
    }
    async function handleDryRun() {
        if (!onDryRun)
            return;
        try {
            setBusy(true);
            await onDryRun();
        }
        finally {
            setBusy(false);
        }
    }
    async function handleApply() {
        if (!onApply)
            return;
        try {
            setBusy(true);
            await onApply(commitMessage);
        }
        finally {
            setBusy(false);
        }
    }
    async function handleValidate() {
        if (!onValidate)
            return;
        try {
            setBusy(true);
            await onValidate();
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { style: toolbarWrap, children: [_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flex: 1 }, children: [_jsx("button", { onClick: handlePlan, disabled: disabled || busy, style: primaryButton, children: busy ? "Working…" : "Plan" }), _jsx("button", { onClick: handleStream, disabled: disabled || streaming, style: secondaryButton, children: streaming ? "Streaming…" : "Stream" }), _jsx("button", { onClick: handleDryRun, disabled: disabled || busy, style: secondaryButton, children: "Dry-run" }), _jsx("button", { onClick: handleValidate, disabled: disabled || busy, style: secondaryButton, children: "Validate" }), _jsx("div", { style: { width: 8 } }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("input", { "aria-label": "Commit message", placeholder: "Commit message (for Apply)", value: commitMessage, onChange: (e) => setCommitMessage(e.target.value), style: commitInputStyle, disabled: disabled }), _jsx("button", { onClick: handleApply, disabled: disabled || busy, style: applyButton, children: busy ? "Applying…" : "Apply" })] })] }), _jsx("div", { style: { marginLeft: 12 }, children: _jsx("div", { style: { fontSize: 13, color: "#64748b" }, children: status ?? "idle" }) })] }));
}
/* Styles */
const toolbarWrap = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #e6eef3",
    marginBottom: 8
};
const primaryButton = {
    background: "#0ea5a3",
    color: "#fff",
    border: "none",
    padding: "8px 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700
};
const secondaryButton = {
    background: "#eef2ff",
    color: "#0f172a",
    border: "none",
    padding: "8px 10px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700
};
const applyButton = {
    background: "#f59e0b",
    color: "#fff",
    border: "none",
    padding: "8px 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700
};
const commitInputStyle = {
    border: "1px solid #e6eef3",
    padding: "8px",
    borderRadius: 8,
    minWidth: 320
};
