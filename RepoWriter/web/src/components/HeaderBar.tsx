// RepoWriter/web/src/components/HeaderBar.tsx
import React, { useEffect, useState } from "react";

type HeaderBarProps = {
  repoName?: string;
  onOpenHelp?: () => void;
};

/**
 * HeaderBar
 *
 * Lightweight header used across the CodeAssistant app.
 * - shows logo/title
 * - shows backend health (ping /api/health)
 * - shows environment badge (mock vs prod based on VITE_API_URL)
 * - lightweight "Undo last repowriter commit" control (calls history/rollback)
 *
 * Now also exposes a small rail-toggle button which emits a global CustomEvent
 * that the Layout listens to (repowriter:toggleRail).
 */
export default function HeaderBar({ repoName = "RepoWriter", onOpenHelp }: HeaderBarProps) {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [envLabel, setEnvLabel] = useState<string>("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL ?? "";
    if (base && (base.includes("localhost") || base.includes("127.0.0.1"))) {
      setEnvLabel("mock");
    } else if (base) {
      setEnvLabel("external");
    } else {
      setEnvLabel("prod");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function ping() {
      try {
        const res = await fetch("/api/health");
        if (!mounted) return;
        setBackendOk(res.ok && (await res.json())?.ok === true);
      } catch {
        if (!mounted) return;
        setBackendOk(false);
      }
    }
    ping();
    const id = setInterval(ping, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  async function undoLastCommit() {
    if (!confirm("Undo most recent repowriter commit? This will reset the repository to the previous state.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/history");
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const commits = j.commits ?? [];
      if (!Array.isArray(commits) || commits.length === 0) {
        alert("No repowriter commits found.");
        setBusy(false);
        return;
      }
      const sha = commits[0].sha;
      if (!confirm(`Rollback commit ${sha}?`)) {
        setBusy(false);
        return;
      }
      const p = await fetch("/api/history/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha: sha })
      });
      const body = await p.json().catch(() => null);
      if (p.ok && body?.ok) {
        alert(`Rolled back commit ${sha}`);
      } else {
        alert(`Rollback failed: ${body?.error ?? JSON.stringify(body)}`);
      }
    } catch (err: any) {
      alert(`Undo failed: ${String(err?.message || err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header style={headerStyle}>
      <div style={leftStyle}>
        {/* rail toggle (compact) */}
        <button
          title="Toggle left rail"
          onClick={() => {
            try {
              window.dispatchEvent(new CustomEvent("repowriter:toggleRail"));
            } catch {
              // fallback for older browsers
              const e: any = document.createEvent("CustomEvent");
              e.initCustomEvent("repowriter:toggleRail", true, true, {});
              window.dispatchEvent(e);
            }
          }}
          style={railToggleStyle}
        >
          ☰
        </button>

        <div style={logoStyle}>
          <div style={{ fontWeight: 700, fontSize: 16, marginRight: 8 }}>RepoWriter</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>{repoName}</div>
        </div>
      </div>

      <div style={centerStyle}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <StatusPill label={`Env: ${envLabel}`} tone="muted" />
          <StatusPill
            label={backendOk === null ? "Backend: ..." : backendOk ? "Backend: OK" : "Backend: Down"}
            tone={backendOk ? "ok" : backendOk === null ? "muted" : "err"}
          />
        </div>
      </div>

      <div style={rightStyle}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button title="Help / Docs" onClick={() => onOpenHelp?.()} style={iconButtonStyle}>
            ?
          </button>
          <button
            title="Undo last repowriter commit"
            onClick={undoLastCommit}
            disabled={busy}
            style={{ ...actionButtonStyle, opacity: busy ? 0.6 : 1 }}
          >
            Undo last
          </button>
        </div>
      </div>
    </header>
  );
}

/* Small presentational bits */

function StatusPill({ label, tone = "muted" }: { label: string; tone?: "muted" | "ok" | "err" }) {
  const bg =
    tone === "ok" ? "#10B981" : tone === "err" ? "#EF4444" : "transparent";
  const color = tone === "muted" ? "#374151" : "#ffffff";
  const style: React.CSSProperties =
    tone === "muted"
      ? { padding: "6px 10px", borderRadius: 20, border: "1px solid #e6eef3", fontSize: 12, color: "#374151" }
      : { padding: "6px 10px", borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 600 };

  return <div style={style}>{label}</div>;
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 14px",
  borderBottom: "1px solid #e6eef3",
  background: "#fff",
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: "var(--topbar-height, 56px)",
  zIndex: 1100,
  boxSizing: "border-box",
};

const leftStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12 };
const centerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", flex: 1 };
const rightStyle: React.CSSProperties = { display: "flex", alignItems: "center" };

const logoStyle: React.CSSProperties = { display: "flex", flexDirection: "column" };

const iconButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: "1px solid #e6eef3",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 700
};

const actionButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700
};

const railToggleStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: "1px solid #e6eef3",
  background: "transparent",
  cursor: "pointer",
  fontSize: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

