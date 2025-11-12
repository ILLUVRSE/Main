import React, { useEffect, useState } from "react";
import logo from "../assets/illuvrse-logo.svg";
import ThemeToggle from "./ThemeToggle";

/**
 * Topbar: brand, backend selector and theme toggle.
 *
 * - Stores backend choice in localStorage under 'repowriter_backend'
 * - Uses CSS classes from illuvrse.css (.topbar, .brand, .controls)
 */

const BACKEND_KEY = "repowriter_backend";

export default function Topbar(): JSX.Element {
  const [backend, setBackend] = useState<"openai" | "local">(() => {
    try {
      const stored = localStorage.getItem(BACKEND_KEY) as "openai" | "local" | null;
      return stored || "openai";
    } catch {
      return "openai";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(BACKEND_KEY, backend);
    } catch {
      // ignore
    }
  }, [backend]);

  return (
    <div className="topbar">
      <div className="brand" style={{ gap: 12 }}>
        <img src={logo} alt="ILLUVRSE" style={{ height: 36 }} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ fontWeight: 800 }}>ILLUVRSE Codex</span>
          <small style={{ color: "var(--muted)", fontSize: 12 }}>RepoWriter</small>
        </div>
      </div>

      <div className="controls" style={{ alignItems: "center" }}>
        <label style={{ marginRight: 8, fontSize: 13, color: "var(--muted)" }}>Backend</label>
        <select
          value={backend}
          onChange={(e) => setBackend(e.target.value as "openai" | "local")}
          aria-label="Select backend"
          style={{ padding: "6px 8px", borderRadius: 8, marginRight: 12 }}
        >
          <option value="openai">OpenAI</option>
          <option value="local">Local Mock</option>
        </select>

        <ThemeToggle />

        <button
          className="btn btn-ghost btn-small"
          style={{ marginLeft: 8 }}
          onClick={() => {
            // placeholder sign-in action (expand later)
            alert("Sign in / auth not implemented in local dev.");
          }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

