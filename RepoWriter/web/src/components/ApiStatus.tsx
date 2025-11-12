import React, { useEffect, useState } from "react";

/**
 * ApiStatus
 *
 * - Shows the effective API base (repowriter_api_base or default)
 * - Lets you ping /api/health and shows the JSON response
 * - Allows changing and resetting the API base
 *
 * Useful during dev to switch between local mock and server
 */

const STORAGE_KEY = "repowriter_api_base";
const DEFAULT_BASE = "http://localhost:7071";

function getStoredBase(): string | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s && s.trim()) return s.trim();
  } catch {}
  return null;
}

export default function ApiStatus(): JSX.Element {
  const [apiBase, setApiBase] = useState<string>(() => getStoredBase() || DEFAULT_BASE);
  const [input, setInput] = useState<string>(apiBase);
  const [lastHealth, setLastHealth] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(apiBase);
  }, [apiBase]);

  function saveBase(b: string) {
    try {
      if (!b) {
        localStorage.removeItem(STORAGE_KEY);
        setApiBase(DEFAULT_BASE);
        return;
      }
      localStorage.setItem(STORAGE_KEY, b);
      setApiBase(b);
    } catch (err) {
      // ignore
    }
  }

  async function pingHealth() {
    setLoading(true);
    setError(null);
    setLastHealth(null);
    try {
      const base = (getStoredBase() || DEFAULT_BASE).replace(/\/$/, "");
      const res = await fetch(`${base}/api/health`);
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        setLastHealth(j);
      } catch {
        setLastHealth({ raw: text });
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  function resetToDefault() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setApiBase(DEFAULT_BASE);
      setInput(DEFAULT_BASE);
    } catch {}
  }

  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>API / Server</strong>
        <div className="small muted">Development helper</div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>API base</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}
            placeholder={DEFAULT_BASE}
          />
          <button className="btn" onClick={() => saveBase(input)}>Save</button>
          <button className="btn btn-ghost" onClick={resetToDefault}>Reset</button>
        </div>
        <div style={{ marginTop: 8, color: "var(--muted)" }}>Effective base: <span style={{ fontFamily: "monospace" }}>{getStoredBase() || DEFAULT_BASE}</span></div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={pingHealth} disabled={loading}>{loading ? "Pinging..." : "Ping /api/health"}</button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              // open base in new tab
              try { window.open((getStoredBase() || DEFAULT_BASE).replace(/\/$/, "") + "/api/health", "_blank", "noopener"); } catch {}
            }}
          >
            Open health in new tab
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
          {!error && lastHealth === null && <div className="muted">No health check yet.</div>}
          {lastHealth !== null && (
            <div className="card" style={{ marginTop: 8 }}>
              <div style={{ fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>{JSON.stringify(lastHealth, null, 2)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

