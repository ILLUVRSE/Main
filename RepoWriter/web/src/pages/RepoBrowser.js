import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import Editor from "../components/Editor";
export default function RepoBrowser() {
    const [files, setFiles] = useState([]);
    const [pattern, setPattern] = useState("**/*.*");
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const [content, setContent] = useState("");
    const [fileLoading, setFileLoading] = useState(false);
    const [error, setError] = useState(null);
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
                const text = await res.text();
                throw new Error(`Server ${res.status}: ${text}`);
            }
            const data = await res.json();
            // Expect data.files = string[] or return raw array
            const arr = Array.isArray(data) ? data : data.files ?? [];
            setFiles(arr.map((p) => ({ path: p })));
        }
        catch (err) {
            setError(String(err?.message || err));
        }
        finally {
            setLoading(false);
        }
    }
    function getLanguageForPath(p) {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        if (["ts", "tsx"].includes(ext))
            return "typescript";
        if (["js", "jsx"].includes(ext))
            return "javascript";
        if (["py"].includes(ext))
            return "python";
        if (["go"].includes(ext))
            return "go";
        if (["java"].includes(ext))
            return "java";
        if (["rs"].includes(ext))
            return "rust";
        if (["c", "cpp", "h", "hpp"].includes(ext))
            return "cpp";
        if (["json"].includes(ext))
            return "json";
        if (["md"].includes(ext))
            return "markdown";
        return "text";
    }
    async function openFile(file) {
        setSelected(file);
        setContent("");
        setFileLoading(true);
        setError(null);
        try {
            // call API to get file content
            const url = `/api/repo/file?path=${encodeURIComponent(file.path)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`Server ${res.status}: ${t}`);
            }
            const data = await res.json();
            // Expect { content: "..." }
            setContent(data.content ?? "");
        }
        catch (err) {
            setError(String(err?.message || err));
            setContent("");
        }
        finally {
            setFileLoading(false);
        }
    }
    return (_jsxs("div", { style: { display: "flex", gap: 12, padding: 12 }, children: [_jsxs("div", { style: { width: 360, display: "flex", flexDirection: "column", gap: 8 }, children: [_jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("input", { style: { flex: 1 }, value: pattern, onChange: (e) => setPattern(e.target.value), placeholder: "glob pattern (e.g. src/**/*.ts)" }), _jsx("button", { onClick: loadFiles, disabled: loading, children: loading ? "Loading…" : "Refresh" })] }), error && _jsx("div", { style: { color: "#ff6b6b" }, children: error }), _jsx("div", { style: { overflow: "auto", border: "1px solid #e6eef3", borderRadius: 6, padding: 8, flex: 1 }, children: files.length === 0 ? (_jsx("div", { style: { color: "#64748b" }, children: loading ? "Loading files…" : "No files found" })) : (_jsx("ul", { style: { listStyle: "none", padding: 0, margin: 0 }, children: files.map((f) => (_jsxs("li", { onClick: () => openFile(f), style: {
                                    padding: "6px 8px",
                                    cursor: "pointer",
                                    borderRadius: 4,
                                    background: selected?.path === f.path ? "#eef2ff" : "transparent",
                                    marginBottom: 4,
                                }, children: [_jsx("div", { style: { fontSize: 13, color: "#0f172a" }, children: f.path }), typeof f.size === "number" && _jsxs("div", { style: { fontSize: 11, color: "#64748b" }, children: [f.size, " bytes"] })] }, f.path))) })) })] }), _jsxs("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 8 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("div", { style: { fontWeight: 600 }, children: selected?.path ?? "Select a file to view" }), _jsx("div", { style: { marginLeft: "auto", color: "#64748b" }, children: fileLoading ? "Loading…" : "" })] }), _jsx("div", { style: { flex: 1 }, children: selected ? (_jsx(Editor, { value: content, language: getLanguageForPath(selected.path), onChange: (v) => setContent(v), height: "70vh" })) : (_jsx("div", { style: { color: "#64748b" }, children: "No file selected" })) })] })] }));
}
