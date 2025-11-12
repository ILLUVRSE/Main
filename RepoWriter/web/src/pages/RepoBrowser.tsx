import React, { useEffect, useState } from "react";
import Editor from "../components/Editor.tsx";

type RepoFile = {
  path: string;
  size?: number;
};

export default function RepoBrowser() {
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [pattern, setPattern] = useState<string>("**/*.*");
  const [loading, setLoading] = useState<boolean>(false);
  const [selected, setSelected] = useState<RepoFile | null>(null);
  const [content, setContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
      const arr: string[] = Array.isArray(data) ? data : data.files ?? [];
      setFiles(arr.map((p) => ({ path: p })));
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

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

  async function openFile(file: RepoFile) {
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
    } catch (err: any) {
      setError(String(err?.message || err));
      setContent("");
    } finally {
      setFileLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, padding: 12 }}>
      <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="glob pattern (e.g. src/**/*.ts)"
          />
          <button onClick={loadFiles} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}

        <div style={{ overflow: "auto", border: "1px solid #e6eef3", borderRadius: 6, padding: 8, flex: 1 }}>
          {files.length === 0 ? (
            <div style={{ color: "#64748b" }}>{loading ? "Loading files…" : "No files found"}</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {files.map((f) => (
                <li
                  key={f.path}
                  onClick={() => openFile(f)}
                  style={{
                    padding: "6px 8px",
                    cursor: "pointer",
                    borderRadius: 4,
                    background: selected?.path === f.path ? "#eef2ff" : "transparent",
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontSize: 13, color: "#0f172a" }}>{f.path}</div>
                  {typeof f.size === "number" && <div style={{ fontSize: 11, color: "#64748b" }}>{f.size} bytes</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{selected?.path ?? "Select a file to view"}</div>
          <div style={{ marginLeft: "auto", color: "#64748b" }}>{fileLoading ? "Loading…" : ""}</div>
        </div>

        <div style={{ flex: 1 }}>
          {selected ? (
            <Editor
              value={content}
              language={getLanguageForPath(selected.path)}
              onChange={(v) => setContent(v)}
              height="70vh"
            />
          ) : (
            <div style={{ color: "#64748b" }}>No file selected</div>
          )}
        </div>
      </div>
    </div>
  );
}

