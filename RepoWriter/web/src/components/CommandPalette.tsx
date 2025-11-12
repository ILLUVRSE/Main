import React, { useEffect, useMemo, useState, useRef } from "react";

/**
 * CommandPalette
 *
 * Minimal command palette (Cmd/Ctrl+K) to run quick actions:
 * - Plan
 * - Stream
 * - Dry-run
 * - Apply
 * - Validate
 * - Toggle Task Board
 *
 * Emits a CustomEvent "repowriter:command" with detail { id: string, label: string } when a command is chosen.
 *
 * Keyboard:
 * - Open: Ctrl/Cmd+K
 * - Navigate: ArrowUp / ArrowDown
 * - Select: Enter
 * - Close: Escape or click outside
 *
 * Lightweight and dependency-free so you can extend easily.
 */

type Cmd = { id: string; label: string; hint?: string };

const DEFAULT_COMMANDS: Cmd[] = [
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
    if (!q) return DEFAULT_COMMANDS;
    return DEFAULT_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || (c.hint || "").toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, commands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
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

  function executeCommand(cmd: Cmd) {
    const event = new CustomEvent("repowriter:command", { detail: cmd });
    window.dispatchEvent(event);
    setOpen(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal
      onClick={() => setOpen(false)}
      style={{
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
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(880px, 94%)",
          borderRadius: 12,
          background: "var(--surface)",
          boxShadow: "0 18px 60px rgba(1,3,6,0.6)",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Type a command or search..."
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.06)",
              fontSize: 15,
              outline: "none",
            }}
          />
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Esc to close</div>
        </div>

        <div ref={listRef} style={{ maxHeight: 340, overflow: "auto" }}>
          {commands.length === 0 ? (
            <div style={{ padding: 12, color: "var(--muted)" }}>No commands found</div>
          ) : (
            commands.map((c, idx) => {
              const isActive = idx === activeIdx;
              return (
                <div
                  key={c.id}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => executeCommand(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isActive ? "rgba(28,129,116,0.08)" : "transparent",
                    border: isActive ? "1px solid rgba(28,129,116,0.12)" : "1px solid transparent",
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: 6, background: isActive ? "var(--color-primary)" : "transparent" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{c.label}</div>
                    {c.hint && <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.hint}</div>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.id}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

