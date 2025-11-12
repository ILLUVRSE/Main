import React, { useState } from "react";

type PlanToolbarProps = {
  onPlan?: (opts?: { prompt?: string }) => Promise<void> | void;
  onStream?: (opts?: { prompt?: string }) => Promise<void> | void;
  onDryRun?: () => Promise<void> | void;
  onApply?: (commitMessage?: string) => Promise<void> | void;
  onValidate?: () => Promise<void> | void;
  disabled?: boolean;
  initialCommitMessage?: string;
  status?: string | null;
};

/**
 * PlanToolbar
 *
 * Compact toolbar used above the prompt area.
 * Exposes Plan/Stream/Dry-run/Apply/Validate controls and a small commit message input.
 *
 * Note: The toolbar is logic-light — it calls callbacks provided via props.
 * Keep UI state here (commit message, loading flags, streaming indicator).
 */
export default function PlanToolbar({
  onPlan,
  onStream,
  onDryRun,
  onApply,
  onValidate,
  disabled = false,
  initialCommitMessage = "",
  status = null
}: PlanToolbarProps) {
  const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);

  async function handlePlan() {
    if (!onPlan) return;
    try {
      setBusy(true);
      await onPlan();
    } finally {
      setBusy(false);
    }
  }

  async function handleStream() {
    if (!onStream) return;
    try {
      setStreaming(true);
      await onStream();
    } finally {
      setStreaming(false);
    }
  }

  async function handleDryRun() {
    if (!onDryRun) return;
    try {
      setBusy(true);
      await onDryRun();
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!onApply) return;
    try {
      setBusy(true);
      await onApply(commitMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    if (!onValidate) return;
    try {
      setBusy(true);
      await onValidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={toolbarWrap}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
        <button onClick={handlePlan} disabled={disabled || busy} style={primaryButton}>
          {busy ? "Working…" : "Plan"}
        </button>

        <button onClick={handleStream} disabled={disabled || streaming} style={secondaryButton}>
          {streaming ? "Streaming…" : "Stream"}
        </button>

        <button onClick={handleDryRun} disabled={disabled || busy} style={secondaryButton}>
          Dry-run
        </button>

        <button onClick={handleValidate} disabled={disabled || busy} style={secondaryButton}>
          Validate
        </button>

        <div style={{ width: 8 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            aria-label="Commit message"
            placeholder="Commit message (for Apply)"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            style={commitInputStyle}
            disabled={disabled}
          />
          <button onClick={handleApply} disabled={disabled || busy} style={applyButton}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>

      <div style={{ marginLeft: 12 }}>
        <div style={{ fontSize: 13, color: "#64748b" }}>{status ?? "idle"}</div>
      </div>
    </div>
  );
}

/* Styles */
const toolbarWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 0",
  borderBottom: "1px solid #e6eef3",
  marginBottom: 8
};

const primaryButton: React.CSSProperties = {
  background: "#0ea5a3",
  color: "#fff",
  border: "none",
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 700
};

const secondaryButton: React.CSSProperties = {
  background: "#eef2ff",
  color: "#0f172a",
  border: "none",
  padding: "8px 10px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 700
};

const applyButton: React.CSSProperties = {
  background: "#f59e0b",
  color: "#fff",
  border: "none",
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 700
};

const commitInputStyle: React.CSSProperties = {
  border: "1px solid #e6eef3",
  padding: "8px",
  borderRadius: 8,
  minWidth: 320
};

