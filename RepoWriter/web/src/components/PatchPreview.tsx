import React, { useMemo, useState } from "react";
import MonacoEditorWrapper from "./MonacoEditorWrapper.tsx";
import DiffViewer from "./DiffViewer.tsx";

type Patch = {
  path?: string;
  content?: string;
  diff?: string;
};

type Props = {
  patch: Patch;
  defaultView?: "content" | "diff" | "raw";
  className?: string;
  // readOnly for editor view
  readOnly?: boolean;
};

export default function PatchPreview({ patch, defaultView = "content", className, readOnly = true }: Props) {
  const hasContent = typeof patch.content === "string" && patch.content.length > 0;
  const hasDiff = typeof patch.diff === "string" && patch.diff.length > 0;

  // decide initial view
  const initial = useMemo(() => {
    if (defaultView) return defaultView;
    if (hasContent) return "content";
    if (hasDiff) return "diff";
    return "raw";
  }, [defaultView, hasContent, hasDiff]);

  const [view, setView] = useState<"content" | "diff" | "raw">(initial);

  function downloadFile(filename: string, contents: string | undefined) {
    const blob = new Blob([contents ?? ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const pathLabel = patch.path || "(untitled)";

  return (
    <div className={className}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>{pathLabel}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{hasContent ? "content" : ""}{hasContent && hasDiff ? " • " : ""}{hasDiff ? "diff" : ""}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* View buttons */}
          <button
            className={`btn ${view === "content" ? "btn-primary" : ""}`}
            onClick={() => setView("content")}
            disabled={!hasContent}
            title="View content (full file)"
          >
            Content
          </button>

          <button
            className={`btn ${view === "diff" ? "btn-primary" : ""}`}
            onClick={() => setView("diff")}
            disabled={!hasDiff}
            title="View unified diff"
          >
            Diff
          </button>

          <button
            className={`btn ${view === "raw" ? "btn-primary" : ""}`}
            onClick={() => setView("raw")}
            title="View raw"
          >
            Raw
          </button>

          {/* Download */}
          {hasContent && (
            <button
              className="btn btn-ghost btn-small"
              onClick={() => downloadFile((patch.path || "file") + ".txt", patch.content)}
            >
              Download Content
            </button>
          )}
          {hasDiff && (
            <button
              className="btn btn-ghost btn-small"
              onClick={() => downloadFile((patch.path || "patch") + ".diff", patch.diff)}
            >
              Download Diff
            </button>
          )}
        </div>
      </div>

      <div style={{ borderRadius: 8, overflow: "hidden" }}>
        {view === "content" && (
          <>
            {hasContent ? (
              <MonacoEditorWrapper
                value={patch.content || ""}
                language={guessLanguageFromPath(patch.path)}
                readOnly={!!readOnly}
                height={360}
              />
            ) : (
              <div style={{ padding: 12, color: "var(--muted)" }}>No content available for this patch.</div>
            )}
          </>
        )}

        {view === "diff" && (
          <>
            {hasDiff ? (
              <div style={{ padding: 0 }}>
                <DiffViewer diff={patch.diff} sideBySide={true} />
              </div>
            ) : (
              <div style={{ padding: 12, color: "var(--muted)" }}>No diff available for this patch.</div>
            )}
          </>
        )}

        {view === "raw" && (
          <div style={{ padding: 12, background: "var(--surface)", borderRadius: 8, fontFamily: "monospace", whiteSpace: "pre-wrap", fontSize: 13 }}>
            <strong style={{ display: "block", marginBottom: 8 }}>Raw content</strong>
            {hasContent ? (
              <pre style={{ margin: 0 }}>{patch.content}</pre>
            ) : hasDiff ? (
              <pre style={{ margin: 0 }}>{patch.diff}</pre>
            ) : (
              <div style={{ color: "var(--muted)" }}>No data available</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** crude guess for monaco language from file extension */
function guessLanguageFromPath(p?: string | undefined) {
  if (!p) return "javascript";
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return ext === "tsx" ? "typescript" : "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
    case "scss":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "sh":
    case "bash":
      return "shell";
    default:
      return "javascript";
  }
}

