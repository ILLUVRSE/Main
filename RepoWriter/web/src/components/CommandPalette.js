import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useRef } from "react";
const DEFAULT_COMMANDS = [
    { id: "plan", label: "Plan (sync)", hint: "Create structured plan from prompt" },
    { id: "stream", label: "Stream plan", hint: "Stream plan fragments (SSE)" },
    { id: "dry", label: "Dry-run selected", hint: "Simulate applying patches" },
    { id: "apply", label: "Apply selected", hint: "Write patches and commit" },
    { id: "validate", label: "Validate patches", hint: "Run tests in sandbox" },
    { id: "toggle-taskboard", label: "Toggle Task Board", hint: "Show/hide left Task Board" },
];
export default function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    useEffect(() => {
        function onKey(e) {
            const isMac = navigator.platform.toLowerCase().includes("mac");
            const mod = isMac ? e.metaKey : e.ctrlKey;
            if (mod && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setOpen((o) => {
                    const next = !o;
                    if (next) {
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }
                    return next;
                });
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    useEffect(() => {
        if (open) {
            setQuery("");
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);
    const commands = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return DEFAULT_COMMANDS;
        return DEFAULT_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || (c.hint || "").toLowerCase().includes(q));
    }, [query]);
    useEffect(() => {
        function onKey(e) {
            if (!open)
                return;
            if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, commands.length - 1));
            }
            else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
            }
            else if (e.key === "Enter") {
                e.preventDefault();
                if (commands.length > 0) {
                    executeCommand(commands[activeIdx]);
                }
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, commands, activeIdx]);
    function executeCommand(cmd) {
        const event = new CustomEvent("repowriter:command", { detail: cmd });
        window.dispatchEvent(event);
        setOpen(false);
    }
    if (!open) {
        return null;
    }
    return (_jsx("div", { role: "dialog", "aria-modal": true, onClick: () => setOpen(false), style: {
            position: "fixed",
            left: 0,
            top: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(2,6,10,0.45)",
            zIndex: 2200,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "12vh",
        }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: {
                width: "min(880px, 94%)",
                borderRadius: 12,
                background: "var(--surface)",
                boxShadow: "0 18px 60px rgba(1,3,6,0.6)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
            }, children: [_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("input", { ref: inputRef, value: query, onChange: (e) => {
                                setQuery(e.target.value);
                                setActiveIdx(0);
                            }, placeholder: "Type a command or search...", style: {
                                flex: 1,
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: "1px solid rgba(0,0,0,0.06)",
                                fontSize: 15,
                                outline: "none",
                            } }), _jsx("div", { style: { color: "var(--muted)", fontSize: 13 }, children: "Esc to close" })] }), _jsx("div", { ref: listRef, style: { maxHeight: 340, overflow: "auto" }, children: commands.length === 0 ? (_jsx("div", { style: { padding: 12, color: "var(--muted)" }, children: "No commands found" })) : (commands.map((c, idx) => {
                        const isActive = idx === activeIdx;
                        return (_jsxs("div", { onMouseEnter: () => setActiveIdx(idx), onClick: () => executeCommand(c), style: {
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: "10px 12px",
                                borderRadius: 8,
                                cursor: "pointer",
                                background: isActive ? "rgba(28,129,116,0.08)" : "transparent",
                                border: isActive ? "1px solid rgba(28,129,116,0.12)" : "1px solid transparent",
                            }, children: [_jsx("div", { style: { width: 6, height: 6, borderRadius: 6, background: isActive ? "var(--color-primary)" : "transparent" } }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 700, color: "var(--text)" }, children: c.label }), c.hint && _jsx("div", { style: { fontSize: 12, color: "var(--muted)" }, children: c.hint })] }), _jsx("div", { style: { fontSize: 12, color: "var(--muted)" }, children: c.id })] }, c.id));
                    })) })] }) }));
}
