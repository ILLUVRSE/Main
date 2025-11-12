import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
/**
 * HeaderBar
 *
 * Lightweight header used across the CodeAssistant app.
 * - shows logo/title
 * - shows backend health (ping /api/health)
 * - shows environment badge (mock vs prod based on VITE_API_URL)
 * - lightweight "Undo last repowriter commit" control (calls history/rollback)
 *
 * The component is intentionally dependency-free (no external toast lib).
 */
export default function HeaderBar({ repoName = "RepoWriter", onOpenHelp }) {
    const [backendOk, setBackendOk] = useState(null);
    const [envLabel, setEnvLabel] = useState("unknown");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const base = import.meta.env.VITE_API_URL ?? "";
        if (base && (base.includes("localhost") || base.includes("127.0.0.1"))) {
            setEnvLabel("mock");
        }
        else if (base) {
            setEnvLabel("external");
        }
        else {
            setEnvLabel("prod");
        }
    }, []);
    useEffect(() => {
        let mounted = true;
        async function ping() {
            try {
                const res = await fetch("/api/health");
                if (!mounted)
                    return;
                setBackendOk(res.ok && (await res.json())?.ok === true);
            }
            catch {
                if (!mounted)
                    return;
                setBackendOk(false);
            }
        }
        ping();
        const id = setInterval(ping, 10_000);
        return () => {
            mounted = false;
            clearInterval(id);
        };
    }, []);
    async function undoLastCommit() {
        if (!confirm("Undo most recent repowriter commit? This will reset the repository to the previous state."))
            return;
        setBusy(true);
        try {
            // Get repowriter commits
            const r = await fetch("/api/history");
            if (!r.ok)
                throw new Error(await r.text());
            const j = await r.json();
            const commits = j.commits ?? [];
            if (!Array.isArray(commits) || commits.length === 0) {
                alert("No repowriter commits found.");
                setBusy(false);
                return;
            }
            // Use the most recent repowriter commit (first in array)
            const sha = commits[0].sha;
            if (!confirm(`Rollback commit ${sha}?`)) {
                setBusy(false);
                return;
            }
            const p = await fetch("/api/history/rollback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commitSha: sha })
            });
            const body = await p.json().catch(() => null);
            if (p.ok && body?.ok) {
                alert(`Rolled back commit ${sha}`);
            }
            else {
                alert(`Rollback failed: ${body?.error ?? JSON.stringify(body)}`);
            }
        }
        catch (err) {
            alert(`Undo failed: ${String(err?.message || err)}`);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("header", { style: headerStyle, children: [_jsx("div", { style: leftStyle, children: _jsxs("div", { style: logoStyle, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 18, marginRight: 8 }, children: "RepoWriter" }), _jsx("div", { style: { fontSize: 12, color: "#6b7280" }, children: repoName })] }) }), _jsx("div", { style: centerStyle, children: _jsxs("div", { style: { display: "flex", gap: 12, alignItems: "center" }, children: [_jsx(StatusPill, { label: `Env: ${envLabel}`, tone: "muted" }), _jsx(StatusPill, { label: backendOk === null ? "Backend: ..." : backendOk ? "Backend: OK" : "Backend: Down", tone: backendOk ? "ok" : backendOk === null ? "muted" : "err" })] }) }), _jsx("div", { style: rightStyle, children: _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("button", { title: "Help / Docs", onClick: () => onOpenHelp?.(), style: iconButtonStyle, children: "?" }), _jsx("button", { title: "Undo last repowriter commit", onClick: undoLastCommit, disabled: busy, style: { ...actionButtonStyle, opacity: busy ? 0.6 : 1 }, children: "Undo last" })] }) })] }));
}
/* Small presentational bits */
function StatusPill({ label, tone = "muted" }) {
    const bg = tone === "ok" ? "#10B981" : tone === "err" ? "#EF4444" : "transparent";
    const color = tone === "muted" ? "#374151" : "#ffffff";
    const style = tone === "muted"
        ? { padding: "6px 10px", borderRadius: 20, border: "1px solid #e6eef3", fontSize: 12, color: "#374151" }
        : { padding: "6px 10px", borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 600 };
    return _jsx("div", { style: style, children: label });
}
const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid #e6eef3",
    background: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 50
};
const leftStyle = { display: "flex", alignItems: "center" };
const centerStyle = { display: "flex", alignItems: "center", justifyContent: "center", flex: 1 };
const rightStyle = { display: "flex", alignItems: "center" };
const logoStyle = { display: "flex", flexDirection: "column" };
const iconButtonStyle = {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "1px solid #e6eef3",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 700
};
const actionButtonStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700
};
