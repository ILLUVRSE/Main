import React, { useMemo, useState } from "react";

/**
 * Lightweight Task type (kept local to avoid import cycles).
 * Keep in sync with LeftTaskBoard.Task if you change shape.
 */
export type TaskStatus = "draft" | "running" | "validated" | "applied" | "failed" | "rolledback";

export type Task = {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt?: string;
  status: TaskStatus;
  plan?: any;
  lastError?: string | null;
};

type Props = {
  task: Task;
  onEdit?: () => void;
  onRemove?: () => void;
  onRun?: () => void;
  onImport?: () => void;
  onSave?: (fields: Partial<Task>) => void;
};

function statusColor(status: TaskStatus) {
  switch (status) {
    case "draft":
      return "var(--muted)";
    case "running":
      return "var(--color-primary)";
    case "validated":
      return "var(--highlight, var(--color-primary-light))";
    case "applied":
      return "var(--success)";
    case "failed":
      return "var(--danger)";
    case "rolledback":
      return "orange";
    default:
      return "var(--muted)";
  }
}

function shortDate(s?: string) {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return s;
  }
}

export default function TaskCard({ task, onEdit, onRemove, onRun, onImport, onSave }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);

  // show a short preview of the prompt (first line or 120 chars)
  const preview = useMemo(() => {
    const p = (task.prompt || "").trim().split("\n")[0] ?? "";
    if (p.length > 120) return p.slice(0, 117) + "...";
    return p;
  }, [task.prompt]);

  function handleSave() {
    if (onSave) onSave({ title: title.trim(), prompt: prompt.trim() });
    setEditing(false);
  }

  function handleCancel() {
    setTitle(task.title);
    setPrompt(task.prompt);
    setEditing(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 12,
            background: statusColor(task.status),
            marginTop: 6,
            flex: "0 0 auto"
          }}
          title={`status: ${task.status}`}
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!editing ? (
              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14 }}>{task.title}</div>
            ) : (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)" }}
              />
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{shortDate(task.updatedAt ?? task.createdAt)}</div>
              {!editing && (
                <button
                  onClick={() => setExpanded((s) => !s)}
                  title="Toggle details"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--muted)",
                    padding: 6,
                    borderRadius: 6,
                    cursor: "pointer"
                  }}
                >
                  {expanded ? "▴" : "▾"}
                </button>
              )}
            </div>
          </div>

          {/* prompt / preview area */}
          <div style={{ marginTop: 8 }}>
            {!editing ? (
              <div style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }}>{preview}</div>
            ) : (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                style={{ width: "100%", minHeight: 80, padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)" }}
              />
            )}
          </div>

          {/* expanded details */}
          {expanded && (
            <div style={{ marginTop: 8, borderTop: "1px dashed rgba(255,255,255,0.03)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }}>{task.prompt}</div>

              {task.plan ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Plan: {Array.isArray(task.plan.steps) ? `${task.plan.steps.length} step(s)` : "unknown"}
                </div>
              ) : null}

              {task.lastError ? (
                <div style={{ color: "var(--danger)", fontSize: 13 }}>{task.lastError}</div>
              ) : null}
            </div>
          )}

          {/* actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!editing ? (
              <>
                <button
                  onClick={() => onRun?.()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--color-primary)",
                    color: "#fff"
                  }}
                  title="Run local planner for this task"
                >
                  Run
                </button>

                <button
                  onClick={() => onImport?.()}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "transparent",
                    color: "var(--muted)"
                  }}
                  title="Import validated plan into the Codex workspace"
                >
                  Import
                </button>

                <button
                  onClick={() => {
                    setEditing(true);
                    onEdit?.();
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "transparent",
                    color: "var(--muted)"
                  }}
                  title="Edit task"
                >
                  Edit
                </button>

                <button
                  onClick={() => onRemove?.()}
                  style={{
                    marginLeft: "auto",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "transparent",
                    color: "var(--danger)"
                  }}
                  title="Remove task"
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--color-primary)",
                    color: "#fff"
                  }}
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "transparent",
                    color: "var(--muted)"
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

