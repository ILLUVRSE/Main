import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import TaskCard from "./TaskCard";
import { generateLocalPlan } from "../services/llm";
import "../theme/illuvrse.css";
function makeId() {
    return Math.random().toString(36).slice(2, 9);
}
/**
 * LeftTaskBoard
 *
 * A compact task board used by the ILLUVRSE Codex layout.
 * - Create/edit simple tasks (title + prompt)
 * - Run a local LLM planner for the task (calls /api/llm/local/plan via services/llm)
 * - Shows task status and a small action menu
 *
 * This component is intentionally lightweight and unopinionated about
 * data persistence. You can later wire it to a server-side storage or
 * localStorage. For now it keeps tasks in component state.
 */
export default function LeftTaskBoard() {
    const [tasks, setTasks] = useState(() => {
        // seed with a couple of example tasks for dev convenience
        const now = new Date().toISOString();
        return [
            {
                id: makeId(),
                title: "Create hello.txt",
                prompt: 'Create a file "hello.txt" that contains the text: "Hello from RepoWriter mock!"',
                createdAt: now,
                status: "draft",
                plan: undefined,
                lastError: null
            },
            {
                id: makeId(),
                title: "Add utils/summarize.ts",
                prompt: "Add a TypeScript utility `utils/summarize.ts` with a `summarize(text: string): string` function that returns the first sentence.",
                createdAt: now,
                status: "draft",
                plan: undefined,
                lastError: null
            }
        ];
    });
    const [editingId, setEditingId] = useState(null);
    const [newTitle, setNewTitle] = useState("");
    const [newPrompt, setNewPrompt] = useState("");
    useEffect(() => {
        // noop for now; placeholder if we later fetch tasks from server/localStorage
    }, []);
    function upsertTask(task) {
        setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === task.id);
            if (idx === -1)
                return [task, ...prev];
            const copy = [...prev];
            copy[idx] = task;
            return copy;
        });
    }
    function createTask() {
        const id = makeId();
        const now = new Date().toISOString();
        const t = {
            id,
            title: newTitle.trim() || "Untitled task",
            prompt: newPrompt.trim() || "",
            createdAt: now,
            updatedAt: now,
            status: "draft",
            plan: undefined,
            lastError: null
        };
        upsertTask(t);
        setNewTitle("");
        setNewPrompt("");
        setEditingId(id);
    }
    function removeTask(id) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        if (editingId === id)
            setEditingId(null);
    }
    async function runTaskPlan(taskId) {
        const t = tasks.find((x) => x.id === taskId);
        if (!t)
            return;
        // set running
        upsertTask({ ...t, status: "running", lastError: null, updatedAt: new Date().toISOString() });
        try {
            // Call the local planner. This function (generateLocalPlan) is implemented in services/llm.ts
            const plan = await generateLocalPlan(t.prompt);
            upsertTask({
                ...t,
                status: "validated",
                plan,
                updatedAt: new Date().toISOString(),
                lastError: null
            });
        }
        catch (err) {
            upsertTask({
                ...t,
                status: "failed",
                lastError: String(err?.message || err),
                updatedAt: new Date().toISOString()
            });
        }
    }
    function setTaskField(id, fields) {
        const t = tasks.find((x) => x.id === id);
        if (!t)
            return;
        upsertTask({ ...t, ...fields, updatedAt: new Date().toISOString() });
    }
    function applyTaskPlan(id) {
        // This is a convenience helper: it takes the plan from the task and
        // populates the right-hand Codex UI. Implementation detail: we emit a
        // browser event so the CodeAssistant can pick it up. This avoids tight
        // coupling between LeftTaskBoard and CodeAssistant.
        const t = tasks.find((x) => x.id === id);
        if (!t || !t.plan)
            return;
        const evt = new CustomEvent("repowriter:importPlan", { detail: { plan: t.plan, sourceTask: t } });
        window.dispatchEvent(evt);
        // mark task as validated/applied depending on your flow
        setTaskField(id, { status: "validated" });
    }
    return (_jsxs("div", { style: { padding: 16, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("h3", { style: { margin: 0, color: "var(--text)" }, children: "Task Board" }), _jsx("div", { style: { marginLeft: "auto", display: "flex", gap: 8 }, children: _jsx("button", { onClick: () => {
                                setNewTitle("");
                                setNewPrompt("");
                                setEditingId(null);
                            }, style: {
                                background: "transparent",
                                border: "1px solid rgba(255,255,255,0.06)",
                                color: "var(--muted)",
                                padding: "6px 10px",
                                borderRadius: 8
                            }, children: "New" }) })] }), _jsxs("div", { style: { border: "1px solid rgba(255,255,255,0.04)", padding: 10, borderRadius: 8, background: "var(--surface)" }, children: [_jsx("input", { placeholder: "Task title", value: newTitle, onChange: (e) => setNewTitle(e.target.value), style: { width: "100%", padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 8 } }), _jsx("textarea", { placeholder: "Describe the task in narrative language (this becomes the prompt for the model)", value: newPrompt, onChange: (e) => setNewPrompt(e.target.value), style: { width: "100%", padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)", minHeight: 84 } }), _jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }, children: [_jsx("button", { onClick: () => {
                                    setNewTitle("");
                                    setNewPrompt("");
                                }, style: { padding: "6px 10px", borderRadius: 8, background: "transparent", border: "none", color: "var(--muted)" }, children: "Clear" }), _jsx("button", { onClick: createTask, style: {
                                    padding: "6px 12px",
                                    borderRadius: 8,
                                    background: "var(--color-primary)",
                                    color: "#fff",
                                    border: "none"
                                }, children: "Create Task" })] })] }), _jsx("div", { style: { overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }, children: tasks.map((t) => (_jsx("div", { style: {
                        borderRadius: 8,
                        padding: 10,
                        background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.02))",
                        border: "1px solid rgba(255,255,255,0.03)"
                    }, children: _jsx(TaskCard, { task: t, onEdit: () => setEditingId(t.id), onRemove: () => removeTask(t.id), onRun: () => runTaskPlan(t.id), onImport: () => applyTaskPlan(t.id), onSave: (fields) => setTaskField(t.id, fields) }) }, t.id))) })] }));
}
