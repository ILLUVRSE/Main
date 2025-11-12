import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
export default function ApplyResultPanel({ applyResult, onRefresh, }) {
    const [busy, setBusy] = useState(false);
    if (!applyResult) {
        return (_jsx("div", { style: { padding: 12, color: "#64748b" }, children: "No apply result yet \u2014 run a dry-run or apply to see results here." }));
    }
    const commitSha = applyResult?.commitSha;
    const applied = applyResult?.applied ?? [];
    const rollbackMetadata = applyResult?.rollbackMetadata;
    async function doRollback() {
        if (!confirm("Rollback the apply? This will attempt to restore previous file contents."))
            return;
        setBusy(true);
        try {
            let body = {};
            if (rollbackMetadata) {
                body.rollbackMetadata = rollbackMetadata;
            }
            else if (commitSha) {
                body.commitSha = commitSha;
            }
            else {
                alert("No rollback metadata or commit SHA available for this apply.");
                setBusy(false);
                return;
            }
            const res = await fetch("/api/history/rollback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const j = await res.json().catch(() => null);
            if (res.ok && j?.ok) {
                alert("Rollback succeeded.");
                onRefresh?.();
            }
            else {
                alert(`Rollback failed: ${j?.error ?? JSON.stringify(j)}`);
            }
        }
        catch (err) {
            alert(`Rollback error: ${String(err?.message || err)}`);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { style: { padding: 12 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Apply Result" }), _jsxs("div", { style: { border: "1px solid #e6eef3", borderRadius: 8, padding: 12, background: "#fff" }, children: [_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700 }, children: "Status" }), _jsx("div", { style: { marginLeft: "auto", color: applyResult?.ok ? "#10B981" : "#EF4444", fontWeight: 700 }, children: applyResult?.ok ? "OK" : "Failed" })] }), commitSha && (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: "#64748b" }, children: "Commit" }), _jsx("div", { style: { fontWeight: 700 }, children: String(commitSha) })] })), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: "#64748b" }, children: "Files changed" }), applied.length === 0 ? (_jsx("div", { style: { color: "#64748b" }, children: "No files changed" })) : (_jsx("ul", { style: { margin: 0, paddingLeft: 12 }, children: applied.map((a, i) => (_jsx("li", { style: { padding: "6px 0" }, children: _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("div", { style: { fontWeight: 700 }, children: a.path }), _jsx("div", { style: { marginLeft: "auto", fontSize: 12, color: "#64748b" }, children: a.wasCreated ? "created" : "modified" })] }) }, i))) }))] }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 6 }, children: "Logs / details" }), _jsxs("div", { style: { background: "#0b0b0b", color: "#d1fae5", padding: 8, borderRadius: 6, maxHeight: 160, overflow: "auto", fontFamily: "Menlo, Monaco, monospace", fontSize: 12 }, children: [_jsx("div", { children: _jsx("strong", { children: "stdout" }) }), _jsx("pre", { style: { margin: 0, whiteSpace: "pre-wrap" }, children: String(applyResult?.stdout ?? "") }), _jsx("div", { style: { height: 8 } }), _jsx("div", { children: _jsx("strong", { children: "stderr" }) }), _jsx("pre", { style: { margin: 0, whiteSpace: "pre-wrap", color: "#ffd6d6" }, children: String(applyResult?.stderr ?? "") })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, marginTop: 12 }, children: [_jsx("button", { onClick: doRollback, style: { padding: "8px 12px", borderRadius: 8, background: "#ef4444", color: "#fff", border: "none" }, disabled: busy, children: busy ? "Rolling back…" : "Rollback" }), _jsx("button", { onClick: () => {
                                    // show raw result in a new window for debugging
                                    const w = window.open();
                                    if (w) {
                                        w.document.title = "Apply result";
                                        w.document.body.style.whiteSpace = "pre-wrap";
                                        w.document.body.innerText = JSON.stringify(applyResult, null, 2);
                                    }
                                }, style: { padding: "8px 12px", borderRadius: 8, border: "1px solid #e6eef3", background: "#fff" }, children: "View raw" })] })] })] }));
}
