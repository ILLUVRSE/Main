import React, { useEffect, useState } from "react";
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
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [language, setLanguage] = useState<string>("text");
  const [dirty, setDirty] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    function onOpen(e: any) {
      const d = e?.detail ?? {};
      if (!d.path) return;
      setPath(d.path);
      setContent(d.content ?? "");
      setLanguage(getLanguageForPath(d.path));
      setDirty(false);
    }
    window.addEventListener("repo:open-file", onOpen as EventListener);
    return () => window.removeEventListener("repo:open-file", onOpen as EventListener);
  }, []);

  function getLanguageForPath(p: string) {
    const ext = p.split(".").pop()?.toLowerCase() || "";
    if (["ts", "tsx"].includes(ext)) return "typescript";
    if (["js", "jsx"].includes(ext)) return "javascript";
    if (["py"].includes(ext)) return "python";
    if (["go"].includes(ext)) return "go";
    if (["java"].includes(ext)) return "java";
    if (["rs"].includes(ext)) return "rust";
    if (["c", "cpp", "h", "hpp"].includes(ext)) return "cpp";
    if (["json"].includes(ext)) return "json";
    if (["md"].includes(ext)) return "markdown";
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
    } catch {
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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e6eef3", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>{path ?? "No file selected"}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={handleSaveToPatch} style={primaryBtn} disabled={!path || !dirty}>
            Save to patch
          </button>
          <button onClick={handleDownload} style={secondaryBtn} disabled={!path}>
            Download
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 12 }}>
        {path ? (
          <Editor
            value={content}
            language={language}
            onChange={(v) => {
              setContent(v);
              setDirty(true);
            }}
            height="100%"
          />
        ) : (
          <div style={{ padding: 16, color: "#64748b" }}>Open a file from the Repo tree to edit it here.</div>
        )}
      </div>
    </div>
  );
}

