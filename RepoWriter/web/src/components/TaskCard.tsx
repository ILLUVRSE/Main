import React, { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  created?: string;
};

type Props = {
  /**
   * If provided, TaskBoard is controlled by parent.
   * Otherwise it persists tasks to localStorage under key REPOTASKS_KEY.
   */
  tasks?: Task[];
  onChange?: (tasks: Task[]) => void;

  /**
   * Callback when user clicks "Run" on a task.
   */
  onRun?: (task: Task) => void;
};

const REPOTASKS_KEY = "repowriter_tasks_v1";

/**
 * TaskBoard
 * - shows a list of tasks (cards)
 * - add / edit / delete tasks
 * - persist to localStorage when uncontrolled
 * - emits onChange for parent sync
 * - calls onRun(task) when Run pressed
 */
export default function TaskBoard({ tasks: controlledTasks, onChange, onRun }: Props) {
  const uncontrolled = typeof controlledTasks === "undefined";

  const [tasks, setTasks] = useState<Task[]>(() => {
    if (!uncontrolled) return controlledTasks || [];
    try {
      const raw = localStorage.getItem(REPOTASKS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as Task[];
    } catch {
      return [];
    }
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");

  // Keep controlled/uncontrolled in sync
  useEffect(() => {
    if (!uncontrolled) {
      setTasks(controlledTasks || []);
    }
  }, [controlledTasks, uncontrolled]);

  // Persist when uncontrolled
  useEffect(() => {
    if (!uncontrolled) return;
    try {
      localStorage.setItem(REPOTASKS_KEY, JSON.stringify(tasks || []));
    } catch {}
    onChange?.(tasks || []);
  }, [tasks, uncontrolled, onChange]);

  function emitChange(next: Task[]) {
    if (!uncontrolled) {
      onChange?.(next);
    } else {
      setTasks(next);
    }
  }

  function startAdd() {
    setEditingId("__new__");
    setTitleInput("");
    setDescInput("");
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setTitleInput(t.title);
    setDescInput(t.description);
  }

  function cancelEdit() {
    setEditingId(null);
    setTitleInput("");
    setDescInput("");
  }

  function saveEdit() {
    const title = titleInput.trim();
    const desc = descInput.trim();
    if (!title) return alert("Title required");
    if (editingId === "__new__") {
      const t: Task = { id: `t${Date.now()}`, title, description: desc, created: new Date().toISOString() };
      emitChange([t, ...(tasks || [])]);
    } else {
      const next = (tasks || []).map((x) => (x.id === editingId ? { ...x, title, description: desc } : x));
      emitChange(next);
    }
    cancelEdit();
  }

  function removeTask(id: string) {
    if (!confirm("Delete this task?")) return;
    const next = (tasks || []).filter((t) => t.id !== id);
    emitChange(next);
  }

  function handleRun(t: Task) {
    onRun?.(t);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Task Board</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-small" onClick={() => { setTasks([]); onChange?.([]); localStorage.removeItem(REPOTASKS_KEY); }}>
            Clear
          </button>
          <button className="btn btn-primary btn-small" onClick={startAdd}>New Task</button>
        </div>
      </div>

      {editingId && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>{editingId === "__new__" ? "New Task" : "Edit Task"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Title"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)" }}
            />
            <textarea
              placeholder="Description (prompt)"
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              rows={4}
              style={{ padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)", fontFamily: "monospace" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={cancelEdit}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(tasks || []).map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{t.title}</div>
                <div style={{ color: "var(--muted)", marginTop: 6, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{t.description}</div>
                <div className="small" style={{ marginTop: 8 }}>{t.created ? new Date(t.created).toLocaleString() : ""}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => handleRun(t)}>Run</button>
                  <button className="btn" onClick={() => startEditTask(t)}>Edit</button>
                </div>
                <button className="btn btn-ghost btn-small" onClick={() => removeTask(t.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // helper to start edit with the task values
  function startEditTask(t: Task) {
    startEdit(t);
  }
}

