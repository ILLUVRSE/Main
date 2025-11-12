import React, { useEffect, useState } from "react";
import DiffViewer from "./DiffViewer.tsx";

type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

export default function ApplyModal({
  open,
  onClose,
  patches,
  defaultMessage,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  patches: PatchObj[]; // patches that will be applied
  defaultMessage?: string;
  onConfirm: (commitMessage: string) => Promise<void> | void;
  busy?: boolean;
}) {
  const [commitMessage, setCommitMessage] = useState(defaultMessage ?? "");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    setCommitMessage(defaultMessage ?? "");
  }, [defaultMessage]);

  useEffect(() => {
    if (!open) {
      setSelectedIndex(0);
    }
  }, [open]);

  if (!open) return null;

  const selected = patches[selectedIndex];

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={header}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Apply changes</div>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={onClose} style={closeBtn}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div style={{ width: 320, borderRight: "1px solid #e6eef3", paddingRight: 12, overflowY: "auto", maxHeight: "60vh" }}>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>Files to change</div>
            {patches.length === 0 ? (
              <div style={{ color: "#64748b" }}>No patches</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {patches.map((p, i) => (
                  <li
                    key={`${p.path}-${i}`}
                    style={{
                      padding: "8px 6px",
                      borderRadius: 6,
                      background: selectedIndex === i ? "#f8fafc" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    onClick={() => setSelectedIndex(i)}
                  >
                    <div style={{ fontWeight: 700 }}>{p.path}</div>
                    <div style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>{p.content ? "content" : p.diff ? "diff" : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 700 }}>{selected?.path ?? "Preview"}</div>
            </div>

            <div style={{ border: "1px solid #e6eef3", borderRadius: 8, overflow: "hidden", background: "#0b0b0b" }}>
              {selected ? (
                selected.diff ? (
                  <DiffViewer diff={selected.diff} height="60vh" />
                ) : selected.content ? (
                  <div style={{ padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>New / replacement content</div>
                    <div style={{ border: "1px solid #e6eef3", borderRadius: 6, padding: 8, background: "#fff", color: "#0f172a" }}>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{selected.content}</pre>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 12 }}>No preview available</div>
                )
              ) : (
                <div style={{ padding: 12 }}>No file selected</div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message"
            style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #e6eef3" }}
          />
          <button
            onClick={async () => {
              try {
                await onConfirm(commitMessage);
              } catch {
                // swallow — parent should surface errors
              }
            }}
            disabled={busy}
            style={{ padding: "8px 12px", borderRadius: 8, background: "#f59e0b", color: "#fff", border: "none", fontWeight: 700 }}
          >
            {busy ? "Applying…" : "Confirm Apply"}
          </button>

          <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e6eef3", background: "#fff" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* Styles */
const overlay: React.CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  background: "rgba(8,10,12,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const modal: React.CSSProperties = {
  width: "90%",
  maxWidth: 1000,
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 12px 40px rgba(20,30,40,0.18)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const closeBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 18,
  cursor: "pointer",
};

