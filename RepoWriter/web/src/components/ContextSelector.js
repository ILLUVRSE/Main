import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
function estimateTokensFromChars(chars) {
    return Math.max(1, Math.ceil(chars / 4));
}
export default function ContextSelector({ initialSelected = [], maxFiles = 200, onChange }) {
    const [files, setFiles] = useState(null);
    const [choices, setChoices] = useState({});
    const [filter, setFilter] = useState("");
    const [loading, setLoading] = useState(false);
    const [previewPath, setPreviewPath] = useState(null);
    const [previewContent, setPreviewContent] = useState(null);
    const [error, setError] = useState(null);
    // Load file list on mount
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const all = await api.listRepoFiles("**/*.*");
                if (cancelled)
                    return;
                setFiles(all.slice(0, Math.max(maxFiles, all.length)));
                // initialize choices cache for first-first chunk
                const initial = {};
                for (let i = 0; i < Math.min(all.length, maxFiles); i++) {
                    const p = all[i];
                    initial[p] = {
                        path: p,
                        selected: initialSelected.includes(p),
                        snippet: undefined,
                        sizeBytes: undefined,
                        tokensEstimate: undefined
                    };
                }
                setChoices(initial);
            }
            catch (err) {
                setError(String(err?.message || err));
            }
            finally {
                setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Helper: fetch snippet for a path (memoized via state)
    async function fetchSnippet(pathStr) {
        try {
            // If already fetched, return
            const cur = choices[pathStr];
            if (cur && cur.snippet !== undefined)
                return;
            // mark loading snippet (avoid duplicate)
            setChoices(prev => ({ ...(prev || {}), [pathStr]: { ...(prev?.[pathStr] || { path: pathStr, selected: false }), snippet: "...loading", tokensEstimate: prev?.[pathStr]?.tokensEstimate } }));
            const res = await api.getRepoFile(pathStr);
            const content = (res && typeof res.content === "string") ? res.content : "";
            const snippet = content.split(/\r?\n/).filter(Boolean).slice(0, 8).join("\n");
            const tokensEstimate = estimateTokensFromChars(content.length);
            setChoices(prev => ({ ...(prev || {}), [pathStr]: { ...(prev?.[pathStr] || { path: pathStr, selected: false }), snippet, tokensEstimate, sizeBytes: content.length } }));
            return;
        }
        catch (err) {
            setChoices(prev => ({ ...(prev || {}), [pathStr]: { ...(prev?.[pathStr] || { path: pathStr, selected: false }), snippet: "[error loading snippet]" } }));
        }
    }
    // When user picks a preview path, load full content
    useEffect(() => {
        let cancelled = false;
        if (!previewPath) {
            setPreviewContent(null);
            return;
        }
        (async () => {
            try {
                setPreviewContent("loading...");
                const res = await api.getRepoFile(previewPath);
                if (cancelled)
                    return;
                setPreviewContent(res?.content ?? "[empty]");
            }
            catch (err) {
                if (cancelled)
                    return;
                setPreviewContent(`[error] ${String(err?.message || err)}`);
            }
        })();
        return () => { cancelled = true; };
    }, [previewPath]);
    // Filtered list memo
    const filtered = useMemo(() => {
        if (!files)
            return [];
        const q = filter.trim().toLowerCase();
        if (!q)
            return files;
        return files.filter(f => f.toLowerCase().includes(q));
    }, [files, filter]);
    // Total tokens for selected
    const selectionArray = useMemo(() => {
        const arr = Object.values(choices).filter(c => c.selected);
        const selected = arr.map(c => ({ path: c.path, snippet: c.snippet, tokensEstimate: c.tokensEstimate }));
        const total = arr.reduce((s, c) => s + (c.tokensEstimate || 0), 0);
        return { selected, total };
    }, [choices]);
    // Emit onChange when selection changes
    useEffect(() => {
        if (onChange) {
            onChange(selectionArray.selected, selectionArray.total);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionArray.selected.length, selectionArray.total]);
    function toggleSelect(pathStr) {
        setChoices(prev => {
            const cur = prev?.[pathStr] || { path: pathStr, selected: false };
            const next = { ...(prev || {}) };
            next[pathStr] = { ...cur, selected: !cur.selected };
            // If selecting and snippet not loaded, fetch snippet
            if (!cur.snippet && !next[pathStr].snippet && next[pathStr].selected) {
                fetchSnippet(pathStr).catch(() => { });
            }
            return next;
        });
    }
    function selectAllVisible() {
        const visible = filtered.slice(0, 200);
        setChoices(prev => {
            const next = { ...(prev || {}) };
            for (const p of visible) {
                const cur = next[p] || { path: p, selected: false };
                next[p] = { ...cur, selected: true };
                if (!cur.snippet)
                    fetchSnippet(p).catch(() => { });
            }
            return next;
        });
    }
    function clearAll() {
        setChoices(prev => {
            const next = {};
            for (const k of Object.keys(prev || {})) {
                next[k] = { ...prev[k], selected: false };
            }
            return next;
        });
    }
    return (_jsxs("div", { style: { display: "flex", gap: 12 }, children: [_jsxs("div", { style: { width: 420, border: "1px solid #ddd", padding: 12, borderRadius: 6 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [_jsx("strong", { children: "Repository files" }), _jsx("div", { style: { fontSize: 12, color: "#666" }, children: files ? `${files.length} files` : "loading..." })] }), _jsx("div", { style: { marginBottom: 8 }, children: _jsx("input", { placeholder: "Filter files (by path)...", value: filter, onChange: (e) => setFilter(e.target.value), style: { width: "100%", padding: "6px 8px", boxSizing: "border-box" } }) }), _jsxs("div", { style: { marginBottom: 8, display: "flex", gap: 8 }, children: [_jsx("button", { onClick: () => selectAllVisible(), disabled: !files, children: "Select visible" }), _jsx("button", { onClick: () => clearAll(), disabled: !files, children: "Clear" })] }), _jsxs("div", { style: { maxHeight: 420, overflow: "auto", borderTop: "1px solid #f0f0f0", paddingTop: 8 }, children: [loading && _jsx("div", { children: "Loading files..." }), error && _jsx("div", { style: { color: "red" }, children: error }), !files && !loading && _jsx("div", { children: "No files found." }), files && filtered.slice(0, 500).map((p) => {
                                const c = choices[p];
                                const selected = c?.selected ?? false;
                                const snippet = c?.snippet;
                                const tokens = c?.tokensEstimate;
                                return (_jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px", borderBottom: "1px solid #f6f6f6" }, children: [_jsx("input", { type: "checkbox", checked: selected, onChange: () => toggleSelect(p) }), _jsxs("div", { style: { flex: 1 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("div", { style: { fontFamily: "monospace", fontSize: 13 }, children: p }), _jsx("div", { style: { color: "#666", fontSize: 12 }, children: tokens ? `${tokens} tks` : "-" })] }), _jsx("div", { style: { marginTop: 6, fontSize: 12, color: "#444", whiteSpace: "pre-wrap", maxHeight: 80, overflow: "hidden" }, children: snippet ?? _jsx("em", { style: { color: "#999" }, children: "Click filename to preview" }) }), _jsxs("div", { style: { marginTop: 6 }, children: [_jsx("button", { onClick: () => { setPreviewPath(p); fetchSnippet(p).catch(() => { }); }, children: "Preview" }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => { toggleSelect(p); }, children: "Toggle" })] })] })] }, p));
                            })] })] }), _jsxs("div", { style: { flex: 1, border: "1px solid #eee", padding: 12, borderRadius: 6 }, children: [_jsxs("div", { style: { marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("strong", { children: "Selected context" }), _jsxs("div", { style: { color: "#666", fontSize: 13 }, children: [selectionArray.selected.length, " files \u2014 ", selectionArray.total, " tokens (est)"] })] }), _jsxs("div", { style: { maxHeight: 520, overflow: "auto", paddingTop: 6 }, children: [selectionArray.selected.length === 0 && _jsx("div", { style: { color: "#666" }, children: "No files selected \u2014 use the list on the left." }), selectionArray.selected.map(s => (_jsxs("div", { style: { marginBottom: 12, borderBottom: "1px dashed #f0f0f0", paddingBottom: 8 }, children: [_jsx("div", { style: { fontFamily: "monospace", fontSize: 13 }, children: s.path }), _jsx("div", { style: { marginTop: 6, whiteSpace: "pre-wrap", fontSize: 13, color: "#222" }, children: s.snippet ?? "" }), _jsx("div", { style: { marginTop: 6, color: "#666", fontSize: 12 }, children: s.tokensEstimate ? `${s.tokensEstimate} tokens (est)` : "" })] }, s.path)))] }), _jsx("div", { style: { marginTop: 8 }, children: _jsx("button", { onClick: () => {
                                // Emit a trimmed selection via onChange immediately
                                if (onChange)
                                    onChange(selectionArray.selected, selectionArray.total);
                            }, disabled: selectionArray.selected.length === 0, children: "Apply context selection" }) }), _jsxs("div", { style: { marginTop: 16 }, children: [_jsx("strong", { children: "Preview" }), _jsx("div", { style: { marginTop: 8, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, background: "#fafafa", padding: 8, borderRadius: 4, minHeight: 160 }, children: previewPath ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { marginBottom: 8, color: "#333" }, children: previewPath }), _jsx("div", { style: { color: "#111" }, children: previewContent ?? "loading..." })] })) : (_jsx("div", { style: { color: "#666" }, children: "Select a file to preview its full content here." })) })] })] })] }));
}
