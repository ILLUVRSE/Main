import React, { useEffect, useState } from "react";
import LeftTaskBoard from "../components/LeftTaskBoard.tsx";
import CodeAssistant from "../pages/CodeAssistant.tsx";
import SettingsDrawer from "../components/SettingsDrawer.tsx";
import CommandPalette from "../components/CommandPalette.tsx";
import useBackend from "../hooks/useBackend.ts";
import "../theme/illuvrse.css";

/**
 * CodexLayout
 *
 * Top-level split layout that composes:
 * - LeftTaskBoard (task board + local LLM)
 * - CodeAssistant (right: ChatGPT/Codex workspace)
 * - SettingsDrawer and CommandPalette
 *
 * Behavior:
 * - Ctrl/Cmd+K opens the command palette (handled by CommandPalette)
 * - The layout listens for `repowriter:command` events and handles a couple
 *   simple commands locally (toggle task board). Other commands are forwarded
 *   as events so children can react.
 * - The layout also toggles theme (dark/light) and exposes a small topbar.
 */
export default function CodexLayout() {
  const [leftVisible, setLeftVisible] = useState<boolean>(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { settings } = useBackend();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    // Listen to palette commands and handle common ones here
    function onCmd(e: any) {
      const cmd = e?.detail;
      if (!cmd) return;
      if (cmd.id === "toggle-taskboard") {
        setLeftVisible((v) => !v);
        return;
      }
      // Re-dispatch to allow other parts of app to handle (e.g., CodeAssistant)
      window.dispatchEvent(new CustomEvent("repowriter:command:forward", { detail: cmd }));
    }
    window.addEventListener("repowriter:command", onCmd);
    return () => window.removeEventListener("repowriter:command", onCmd);
  }, []);

  // Listen for importPlan events and forward them (CodeAssistant should listen)
  useEffect(() => {
    function onImport(e: any) {
      // forward so CodeAssistant or other parts can react
      window.dispatchEvent(new CustomEvent("repowriter:importPlan:forward", { detail: e.detail }));
      // Also open the right pane if hidden (helpful)
      setLeftVisible(true); // keep left visible but ensure right is visible too (layout always shows right)
    }
    window.addEventListener("repowriter:importPlan", onImport);
    return () => window.removeEventListener("repowriter:importPlan", onImport);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Topbar */}
      <header className="topbar" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect width="24" height="24" rx="6" fill="var(--color-primary)" />
              <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="700">I</text>
            </svg>
            <div style={{ fontWeight: 800 }}>ILLUVRSE Codex</div>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Backend: {settings.backend}</div>
        </div>

        <div className="controls" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setLeftVisible((v) => !v)}
            className="btn btn-ghost"
            title="Toggle Task Board"
            aria-label="Toggle Task Board"
          >
            {leftVisible ? "Hide Tasks" : "Show Tasks"}
          </button>

          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="btn btn-ghost"
            title="Toggle theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>

          {/* SettingsDrawer renders its own button, but expose quick icon here too */}
          <SettingsDrawer />
        </div>
      </header>

      {/* Main split layout */}
      <main className="layout" style={{ alignItems: "stretch" }}>
        {leftVisible && (
          <aside className="left card" style={{ padding: 10 }}>
            <LeftTaskBoard />
          </aside>
        )}

        <section className="right" style={{ padding: 12 }}>
          <CodeAssistant />
        </section>
      </main>

      {/* Command palette and global helpers */}
      <CommandPalette />
    </div>
  );
}

