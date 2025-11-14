import React, { useEffect, useState } from "react";

// RepoTree
//
// Simple file list for the repository. Features:
//  - pattern input (glob) to filter files (defaults to "** / *.*")
//  - file list with refresh
//  - click a file to load its content and dispatch a global event "repo:open-file"
//
// The dispatched event is a CustomEvent with `detail = { path, content }`.
// Consumers (EditorPage, CodeAssistant) can listen for this event to open files.
//
// This component is intentionally lightweight and dependency-free; for very large
// repositories you should replace the list with a virtualized tree (react-window).

export default function RepoTree() {
  const [pattern, setPattern] = useState("**/*.*");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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
      const arr: string[] = Array.isArray(j) ? j : j.files ?? [];
      setFiles(arr.slice(0, 1000));
    } catch (err: any) {
      setError(String(err?.message || err));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  async function openFile(path: string) {
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
      } catch {
        // fallback: open in a new tab as plain text (not ideal)
        const w = window.open();
        if (w) {
          w.document.title = path;
          w.document.body.style.whiteSpace = "pre-wrap";
          w.document.body.innerText = content;
        }
      }
    } catch (err: any) {
      alert(`Failed to open file ${path}: ${String(err?.message || err)}`);
    } finally {
      setSelected(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="glob pattern (e.g. src/**/*.ts)"
          style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #e6eef3" }}
        />
        <button onClick={loadFiles} style={smallBtn} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? <div style={{ color: "#ef4444", marginBottom: 8 }}>{error}</div> : null}

      <div style={{ maxHeight: "60vh", overflow: "auto", borderRadius: 8 }}>
        {files.length === 0 ? (
          <div style={{ color: "#64748b", padding: 8 }}>{loading ? "Loading files…" : "No files found"}</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {files.map((f) => (
              <li
                key={f}
                onClick={() => openFile(f)}
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  background: selected === f ? "#f8fafc" : "transparent",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* small styles */
const smallBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e6eef3",
  background: "#fff",
  cursor: "pointer",
};
