import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import Editor from "../components/Editor";
import useToast from "../hooks/useToast";
/**
 * EditorPage
 *
 * Full-screen editor page using the existing Editor component (Monaco wrapper).
 * - Listens for global `repo:open-file` events with { path, content } to open files.
 * - Allows editing and "Save to patch" which emits a `repo:save-patch` CustomEvent
 *   with detail `{ path, content }` so other parts of the app (CodeAssistant) can
 *   pick up the patch.
 *
 * Usage:
 *  - Click a file in RepoTree -> it dispatches repo:open-file and this page opens it.
 *  - Edit and click "Save to patch" to convert your edits into a patch object.
 */
export default function EditorPage() {
    const [path, setPath] = useState(null);
    const [content, setContent] = useState("");
    const [language, setLanguage] = useState("text");
    const [dirty, setDirty] = useState(false);
    const { push } = useToast();
    useEffect(() => {
        function onOpen(e) {
            const d = e?.detail ?? {};
            if (!d.path)
                return;
            setPath(d.path);
            setContent(d.content ?? "");
            setLanguage(getLanguageForPath(d.path));
            setDirty(false);
        }
        window.addEventListener("repo:open-file", onOpen);
        return () => window.removeEventListener("repo:open-file", onOpen);
    }, []);
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
    function handleSaveToPatch() {
        if (!path) {
            push({ message: "No file open to save", type: "warn" });
            return;
        }
        const patch = { path, content };
        // Dispatch a global event so CodeAssistant or other components can pick it up
        try {
            const ev = new CustomEvent("repo:save-patch", { detail: patch });
            window.dispatchEvent(ev);
            setDirty(false);
            push({ message: `Saved edits to patch for ${path}`, type: "success" });
        }
        catch {
            push({ message: "Failed to emit save-patch event", type: "error" });
        }
    }
    function handleDownload() {
        if (!path) {
            push({ message: "No file open to download", type: "warn" });
            return;
        }
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() || "file.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        push({ message: `Downloaded ${path}`, type: "info", ttlMs: 2500 });
    }
    return (_jsxs("div", { style: { height: "100%", display: "flex", flexDirection: "column" }, children: [_jsxs("div", { style: { padding: 12, borderBottom: "1px solid #e6eef3", display: "flex", gap: 12, alignItems: "center" }, children: [_jsx("div", { style: { fontWeight: 700 }, children: path ?? "No file selected" }), _jsxs("div", { style: { marginLeft: "auto", display: "flex", gap: 8 }, children: [_jsx("button", { onClick: handleSaveToPatch, style: primaryBtn, disabled: !path || !dirty, children: "Save to patch" }), _jsx("button", { onClick: handleDownload, style: secondaryBtn, disabled: !path, children: "Download" })] })] }), _jsx("div", { style: { flex: 1, padding: 12 }, children: path ? (_jsx(Editor, { value: content, language: language, onChange: (v) => {
                        setContent(v);
                        setDirty(true);
                    }, height: "100%" })) : (_jsx("div", { style: { padding: 16, color: "#64748b" }, children: "Open a file from the Repo tree to edit it here." })) })] }));
}
