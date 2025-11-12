import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
export default function CommitHistory() {
    const [commits, setCommits] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/history");
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `HTTP ${res.status}`);
            }
            const j = await res.json();
            setCommits(Array.isArray(j.commits) ? j.commits : []);
        }
        catch (err) {
            setError(String(err?.message || err));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        load();
    }, []);
    async function rollback(commitSha) {
        if (!confirm(`Rollback commit ${commitSha}? This will reset the repository or apply the rollback metadata.`))
            return;
        setBusy(true);
        try {
            const res = await fetch("/api/history/rollback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commitSha })
            });
            const body = await res.json().catch(() => null);
            if (res.ok && body?.ok) {
                alert(`Rolled back commit ${commitSha}`);
                await load();
            }
            else {
                alert(`Rollback failed: ${body?.error ?? JSON.stringify(body)}`);
            }
        }
        catch (err) {
            alert(`Rollback error: ${String(err?.message || err)}`);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "Recent repowriter commits" }), _jsx("button", { onClick: load, style: smallBtn, disabled: loading, children: "Refresh" })] }), loading ? (_jsx("div", { style: { color: "#64748b" }, children: "Loading\u2026" })) : error ? (_jsx("div", { style: { color: "#ef4444" }, children: error })) : commits.length === 0 ? (_jsx("div", { style: { color: "#64748b" }, children: "No repowriter commits found" })) : (_jsx("ul", { style: { listStyle: "none", padding: 0, margin: 0 }, children: commits.slice(0, 20).map((c) => (_jsx("li", { style: { padding: "8px 6px", borderRadius: 6, marginBottom: 8, background: "#fff", border: "1px solid #e6eef3" }, children: _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 13 }, children: c.message }), _jsxs("div", { style: { fontSize: 12, color: "#64748b", marginTop: 6 }, children: [c.sha.slice(0, 7), " \u2022 ", c.date, " \u2022 ", c.author_name] })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [_jsx("button", { onClick: () => {
                                            // show commit details in an alert (simple)
                                            alert(`Commit ${c.sha}\n\nAuthor: ${c.author_name} <${c.author_email ?? "?"}>\nDate: ${c.date}\n\n${c.message}`);
                                        }, style: smallBtn, children: "View" }), _jsx("button", { onClick: () => rollback(c.sha), style: { ...smallBtn, background: "#ef4444", color: "#fff" }, disabled: busy, children: busy ? "Working…" : "Rollback" })] })] }) }, c.sha))) }))] }));
}
/* Styles */
const smallBtn = {
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #e6eef3",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12
};
