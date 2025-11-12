import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";

type ContextFileChoice = {
  path: string;
  selected: boolean;
  snippet?: string;
  sizeBytes?: number;
  tokensEstimate?: number;
};

type Props = {
  /**
   * initial selected file paths (repo-relative)
   */
  initialSelected?: string[];
  /**
   * max files to show initially
   */
  maxFiles?: number;
  /**
   * Called when selection changes:
   *  onChange(selectedFiles: Array<{path, snippet, tokensEstimate}>, totalTokens)
   */
  onChange?: (selected: Array<{ path: string; snippet?: string; tokensEstimate?: number }>, totalTokens: number) => void;
};

function estimateTokensFromChars(chars: number) {
  return Math.max(1, Math.ceil(chars / 4));
}

export default function ContextSelector({ initialSelected = [], maxFiles = 200, onChange }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [choices, setChoices] = useState<Record<string, ContextFileChoice>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load file list on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const all = await api.listRepoFiles("**/*.*");
        if (cancelled) return;
        setFiles(all.slice(0, Math.max(maxFiles, all.length)));
        // initialize choices cache for first-first chunk
        const initial: Record<string, ContextFileChoice> = {};
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
      } catch (err: any) {
        setError(String(err?.message || err));
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: fetch snippet for a path (memoized via state)
  async function fetchSnippet(pathStr: string) {
    try {
      // If already fetched, return
      const cur = choices[pathStr];
      if (cur && cur.snippet !== undefined) return;
      // mark loading snippet (avoid duplicate)
      setChoices(prev => ({ ...(prev || {}), [pathStr]: { ...(prev?.[pathStr] || { path: pathStr, selected: false }), snippet: "...loading", tokensEstimate: prev?.[pathStr]?.tokensEstimate } }));
      const res = await api.getRepoFile(pathStr);
      const content = (res && typeof res.content === "string") ? res.content : "";
      const snippet = content.split(/\r?\n/).filter(Boolean).slice(0, 8).join("\n");
      const tokensEstimate = estimateTokensFromChars(content.length);
      setChoices(prev => ({ ...(prev || {}), [pathStr]: { ...(prev?.[pathStr] || { path: pathStr, selected: false }), snippet, tokensEstimate, sizeBytes: content.length } }));
      return;
    } catch (err) {
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
        if (cancelled) return;
        setPreviewContent(res?.content ?? "[empty]");
      } catch (err: any) {
        if (cancelled) return;
        setPreviewContent(`[error] ${String(err?.message || err)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [previewPath]);

  // Filtered list memo
  const filtered = useMemo(() => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return files;
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

  function toggleSelect(pathStr: string) {
    setChoices(prev => {
      const cur = prev?.[pathStr] || { path: pathStr, selected: false };
      const next = { ...(prev || {}) };
      next[pathStr] = { ...cur, selected: !cur.selected };
      // If selecting and snippet not loaded, fetch snippet
      if (!cur.snippet && !next[pathStr].snippet && next[pathStr].selected) {
        fetchSnippet(pathStr).catch(() => {});
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
        if (!cur.snippet) fetchSnippet(p).catch(() => {});
      }
      return next;
    });
  }

  function clearAll() {
    setChoices(prev => {
      const next: Record<string, ContextFileChoice> = {};
      for (const k of Object.keys(prev || {})) {
        next[k] = { ...prev[k], selected: false };
      }
      return next;
    });
  }

  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ width: 420, border: "1px solid #ddd", padding: 12, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>Repository files</strong>
          <div style={{ fontSize: 12, color: "#666" }}>{files ? `${files.length} files` : "loading..."}</div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Filter files (by path)..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
          <button onClick={() => selectAllVisible()} disabled={!files}>Select visible</button>
          <button onClick={() => clearAll()} disabled={!files}>Clear</button>
        </div>

        <div style={{ maxHeight: 420, overflow: "auto", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
          {loading && <div>Loading files...</div>}
          {error && <div style={{ color: "red" }}>{error}</div>}
          {!files && !loading && <div>No files found.</div>}
          {files && filtered.slice(0, 500).map((p) => {
            const c = choices[p];
            const selected = c?.selected ?? false;
            const snippet = c?.snippet;
            const tokens = c?.tokensEstimate;
            return (
              <div key={p} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px", borderBottom: "1px solid #f6f6f6" }}>
                <input type="checkbox" checked={selected} onChange={() => toggleSelect(p)} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 13 }}>{p}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>{tokens ? `${tokens} tks` : "-"}</div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#444", whiteSpace: "pre-wrap", maxHeight: 80, overflow: "hidden" }}>
                    {snippet ?? <em style={{ color: "#999" }}>Click filename to preview</em>}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button onClick={() => { setPreviewPath(p); fetchSnippet(p).catch(()=>{}); }}>Preview</button>
                    <button style={{ marginLeft: 8 }} onClick={() => { toggleSelect(p); }}>Toggle</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, border: "1px solid #eee", padding: 12, borderRadius: 6 }}>
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Selected context</strong>
          <div style={{ color: "#666", fontSize: 13 }}>{selectionArray.selected.length} files — {selectionArray.total} tokens (est)</div>
        </div>

        <div style={{ maxHeight: 520, overflow: "auto", paddingTop: 6 }}>
          {selectionArray.selected.length === 0 && <div style={{ color: "#666" }}>No files selected — use the list on the left.</div>}
          {selectionArray.selected.map(s => (
            <div key={s.path} style={{ marginBottom: 12, borderBottom: "1px dashed #f0f0f0", paddingBottom: 8 }}>
              <div style={{ fontFamily: "monospace", fontSize: 13 }}>{s.path}</div>
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 13, color: "#222" }}>{s.snippet ?? ""}</div>
              <div style={{ marginTop: 6, color: "#666", fontSize: 12 }}>{s.tokensEstimate ? `${s.tokensEstimate} tokens (est)` : ""}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 8 }}>
          <button onClick={() => {
            // Emit a trimmed selection via onChange immediately
            if (onChange) onChange(selectionArray.selected, selectionArray.total);
          }} disabled={selectionArray.selected.length === 0}>Apply context selection</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <strong>Preview</strong>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, background: "#fafafa", padding: 8, borderRadius: 4, minHeight: 160 }}>
            {previewPath ? (
              <>
                <div style={{ marginBottom: 8, color: "#333" }}>{previewPath}</div>
                <div style={{ color: "#111" }}>{previewContent ?? "loading..."}</div>
              </>
            ) : (
              <div style={{ color: "#666" }}>Select a file to preview its full content here.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

