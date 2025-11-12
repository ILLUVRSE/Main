import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
/**
 * RepoTree
 *
 * Simple file list for the repository. Features:
 *  - pattern input (glob) to filter files (defaults to "**/ 
    * . * ")
    * -file;
list;
with (refresh
    * -click)
    a;
file;
to;
load;
its;
content;
and;
dispatch;
a;
var global;
(function (global) {
})(global || (global = {}));
event;
"repo:open-file"
    *
    * The;
dispatched;
event;
is;
a;
CustomEvent;
with (`detail = { path, content }`.
    * Consumers(EditorPage, CodeAssistant))
    can;
listen;
for (this; event; to)
    open;
files.
    *
    * This;
component;
is;
intentionally;
lightweight;
and;
dependency - free;
for (very; large
    * repositories; you)
    should;
replace;
the;
list;
with (a)
    virtualized;
tree(react - window).
    * /;
export default function RepoTree() {
    const [pattern, setPattern] = useState("**/*.*");
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);
    useEffect(() => {
        loadFiles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    async function loadFiles() {
        setLoading(true);
        setError(null);
        try {
            const url = `/api/repo/list?pattern=${encodeURIComponent(pattern)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const t = await res.text();
                throw new Error(t || `HTTP ${res.status}`);
            }
            const j = await res.json();
            const arr = Array.isArray(j) ? j : j.files ?? [];
            setFiles(arr.slice(0, 1000));
        }
        catch (err) {
            setError(String(err?.message || err));
            setFiles([]);
        }
        finally {
            setLoading(false);
        }
    }
    async function openFile(path) {
        setSelected(path);
        try {
            const url = `/api/repo/file?path=${encodeURIComponent(path)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const t = await res.text();
                throw new Error(t || `HTTP ${res.status}`);
            }
            const j = await res.json();
            const content = j.content ?? "";
            // dispatch a global event so any page can react
            try {
                const ev = new CustomEvent("repo:open-file", { detail: { path, content } });
                window.dispatchEvent(ev);
            }
            catch {
                // fallback: open in a new tab as plain text (not ideal)
                const w = window.open();
                if (w) {
                    w.document.title = path;
                    w.document.body.style.whiteSpace = "pre-wrap";
                    w.document.body.innerText = content;
                }
            }
        }
        catch (err) {
            alert(`Failed to open file ${path}: ${String(err?.message || err)}`);
        }
        finally {
            setSelected(null);
        }
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 8 }, children: [_jsx("input", { value: pattern, onChange: (e) => setPattern(e.target.value), placeholder: "glob pattern (e.g. src/**/*.ts)", style: { flex: 1, padding: 8, borderRadius: 8, border: "1px solid #e6eef3" } }), _jsx("button", { onClick: loadFiles, style: smallBtn, disabled: loading, children: loading ? "Loading…" : "Refresh" })] }), error ? _jsx("div", { style: { color: "#ef4444", marginBottom: 8 }, children: error }) : null, _jsx("div", { style: { maxHeight: "60vh", overflow: "auto", borderRadius: 8 }, children: files.length === 0 ? (_jsx("div", { style: { color: "#64748b", padding: 8 }, children: loading ? "Loading files…" : "No files found" })) : (_jsx("ul", { style: { listStyle: "none", padding: 0, margin: 0 }, children: files.map((f) => (_jsx("li", { onClick: () => openFile(f), style: {
                            padding: "8px 10px",
                            borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            background: selected === f ? "#f8fafc" : "transparent",
                            display: "flex",
                            alignItems: "center",
                        }, children: _jsx("div", { style: { fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: f }) }, f))) })) })] }));
}
/* small styles */
const smallBtn = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #e6eef3",
    background: "#fff",
    cursor: "pointer",
};
