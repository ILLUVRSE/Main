import React, { useMemo, useState } from "react";

export type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

type Props = {
  open: boolean;
  title?: string;
  patches: PatchObj[]; // patches that will be applied
  onClose: () => void;
  /**
   * Called when user confirms apply.
   * - mode: "apply" | "dry" | "validate"
   * - commitMessage: the commit message (only for apply)
   * - saveRollback: whether to persist rollback metadata client-side (UI-concern)
   */
  onConfirm: (opts: { mode: "apply" | "dry" | "validate"; commitMessage?: string; saveRollback?: boolean }) => void;
};

/**
 * ApplyConfirmModal
 *
 * Simple confirmation modal that lists files to be changed, provides a commit message editor,
 * option to run dry/validate/apply, and shows a small rollback preview toggle.
 *
 * Styling is minimal and uses CSS variables from your theme.
 */
export default function ApplyConfirmModal({ open, title = "Confirm Apply", patches, onClose, onConfirm }: Props) {
  const [commitMessage, setCommitMessage] = useState(() => {
    // default commit message derived from patches
    if (!patches || patches.length === 0) return "repowriter: apply";
    const single = patches.length === 1 ? ` ${patches[0].path}` : ` ${patches.length} files`;
    return `repowriter: apply${single}`;
  });
  const [saveRollback, setSaveRollback] = useState(true);
  const [mode, setMode] = useState<"apply" | "dry" | "validate">("apply");
  const [showAllDiffs, setShowAllDiffs] = useState(false);

  // small content preview for each patch
  const previews = useMemo(() => {
    return patches.map((p) => {
      if (p.content) {
        const s = p.content.trim();
        const first = s.split("\n")[0];
        return first.length > 160 ? first.slice(0, 157) + "..." : first;
      }
      if (p.diff) {
        const first = p.diff.split("\n").slice(0, 6).join("\n");
        return first.length > 160 ? first.slice(0, 157) + "..." : first;
      }
      return "";
    });
  }, [patches]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(3,6,9,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 20,
      }}
      onClick={() => onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96%)",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 12,
          background: "var(--surface)",
          padding: 18,
          boxShadow: "0 10px 40px rgba(2,6,10,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13 }}>
            {patches.length} patch{patches.length !== 1 ? "es" : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {/* left: patches list */}
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Files to change</div>

            <div style={{ display: "grid", gap: 8 }}>
              {patches.map((p, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: 8,
                    padding: 8,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(0,0,0,0.02))",
                    border: "1px solid rgba(255,255,255,0.03)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{p.path}</div>
                    <div style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
                      {p.content ? "content" : p.diff ? "unified diff" : "unknown"}
                    </div>
                  </div>

                  <div style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {previews[i] || <span style={{ color: "var(--muted)" }}>No preview available</span>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={showAllDiffs}
                  onChange={(e) => setShowAllDiffs(e.target.checked)}
                />
                Show full diffs/content inline
              </label>
              {showAllDiffs && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {patches.map((p, i) => (
                    <pre
                      key={i}
                      style={{
                        background: "rgba(0,0,0,0.04)",
                        padding: 10,
                        borderRadius: 8,
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                        lineHeight: 1.4,
                      }}
                    >
                      {p.diff ?? p.content ?? "(no preview)"}
                    </pre>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* right: commit & options */}
          <div style={{ width: 420, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Mode</div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="radio" checked={mode === "apply"} onChange={() => setMode("apply")} />
                  <span>Apply</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="radio" checked={mode === "dry"} onChange={() => setMode("dry")} />
                  <span>Dry-run</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="radio" checked={mode === "validate"} onChange={() => setMode("validate")} />
                  <span>Validate</span>
                </label>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Commit message</div>
              <input
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}
                placeholder="Commit message for apply"
              />
            </div>

            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={saveRollback} onChange={(e) => setSaveRollback(e.target.checked)} />
                <span>Save rollback metadata locally (recommended)</span>
              </label>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                If checked, the UI will keep rollback metadata so you can restore changes later without searching logs.
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.06)",
                  background: "transparent",
                  color: "var(--muted)"
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  onConfirm({ mode, commitMessage: commitMessage || undefined, saveRollback });
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: mode === "apply" ? "var(--color-primary)" : "var(--color-primary-light)",
                  color: "#fff",
                  fontWeight: 700
                }}
              >
                {mode === "apply" ? "Apply" : mode === "dry" ? "Run Dry-run" : "Validate"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

