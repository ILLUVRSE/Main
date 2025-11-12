import React, { useEffect, useState } from "react";

/**
 * SettingsDrawer
 *
 * Simple slide-over settings panel for selecting backend and model options.
 * - Backend: "openai" | "local"
 * - OpenAI: API key (optional; if blank, server env is used)
 * - Local: URL to local LLM (e.g., http://127.0.0.1:7860)
 *
 * This component stores settings in localStorage and emits a small CustomEvent
 * ("repowriter:settingsChanged") so other parts of the app can react.
 *
 * It's intentionally minimal — replace styling with your design system or
 * integrate with a context/provider if you prefer.
 */

type Backend = "openai" | "local";

const LS_KEYS = {
  backend: "repowriter_backend",
  openaiKey: "repowriter_openai_key",
  openaiModel: "repowriter_openai_model",
  localUrl: "repowriter_local_url",
  localModel: "repowriter_local_model"
};

export default function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const [backend, setBackend] = useState<Backend>(() => (localStorage.getItem(LS_KEYS.backend) as Backend) || "openai");
  const [openaiKey, setOpenaiKey] = useState<string>(() => localStorage.getItem(LS_KEYS.openaiKey) ?? "");
  const [openaiModel, setOpenaiModel] = useState<string>(() => localStorage.getItem(LS_KEYS.openaiModel) ?? "gpt-4o-mini");
  const [localUrl, setLocalUrl] = useState<string>(() => localStorage.getItem(LS_KEYS.localUrl) ?? "http://127.0.0.1:7860");
  const [localModel, setLocalModel] = useState<string>(() => localStorage.getItem(LS_KEYS.localModel) ?? "local-gpt");

  useEffect(() => {
    // persist and broadcast
    localStorage.setItem(LS_KEYS.backend, backend);
    localStorage.setItem(LS_KEYS.openaiKey, openaiKey);
    localStorage.setItem(LS_KEYS.openaiModel, openaiModel);
    localStorage.setItem(LS_KEYS.localUrl, localUrl);
    localStorage.setItem(LS_KEYS.localModel, localModel);

    const detail = { backend, openaiKey: openaiKey || null, openaiModel, localUrl, localModel };
    window.dispatchEvent(new CustomEvent("repowriter:settingsChanged", { detail }));
  }, [backend, openaiKey, openaiModel, localUrl, localModel]);

  return (
    <>
      <button
        title="Settings"
        onClick={() => setOpen(true)}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--muted)",
          padding: 8,
          cursor: "pointer"
        }}
      >
        ⚙︎
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            right: 16,
            top: 64,
            width: 420,
            maxWidth: "calc(100% - 32px)",
            height: "calc(100% - 96px)",
            background: "var(--surface)",
            boxShadow: "0 8px 32px rgba(10,12,14,0.6)",
            borderRadius: 12,
            padding: 16,
            zIndex: 1200,
            overflowY: "auto"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Settings</h3>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>
          </div>

          <section style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Backend</div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  checked={backend === "openai"}
                  onChange={() => setBackend("openai")}
                />
                <span>OpenAI</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  checked={backend === "local"}
                  onChange={() => setBackend("local")}
                />
                <span>Local LLM</span>
              </label>
            </div>
          </section>

          {backend === "openai" ? (
            <section style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>OpenAI</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  placeholder="OpenAI API Key (optional)"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}
                />
                <label style={{ fontSize: 13, color: "var(--muted)" }}>Model</label>
                <select value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini-1">gpt-4o-mini-1</option>
                </select>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Tip: If API key is blank the server-side OPENAI_API_KEY will be used.
                </div>
              </div>
            </section>
          ) : (
            <section style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Local LLM</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  placeholder="Local LLM URL (e.g., http://127.0.0.1:7860)"
                  value={localUrl}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}
                />
                <label style={{ fontSize: 13, color: "var(--muted)" }}>Local Model</label>
                <input
                  placeholder="Model name / config for local server"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}
                />
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Tip: Set your local server URL and model. The server will proxy requests to this endpoint.
                </div>
              </div>
            </section>
          )}

          <section style={{ marginTop: 18 }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  // reset to saved
                  setBackend(localStorage.getItem(LS_KEYS.backend) as Backend || "openai");
                  setOpenaiKey(localStorage.getItem(LS_KEYS.openaiKey) ?? "");
                  setOpenaiModel(localStorage.getItem(LS_KEYS.openaiModel) ?? "gpt-4o-mini");
                  setLocalUrl(localStorage.getItem(LS_KEYS.localUrl) ?? "http://127.0.0.1:7860");
                  setLocalModel(localStorage.getItem(LS_KEYS.localModel) ?? "local-gpt");
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.06)",
                  background: "transparent",
                  color: "var(--muted)"
                }}
              >
                Reset
              </button>

              <button
                onClick={() => {
                  // Save done via useEffect — just close drawer
                  setOpen(false);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--color-primary)",
                  color: "#fff"
                }}
              >
                Save & Close
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

