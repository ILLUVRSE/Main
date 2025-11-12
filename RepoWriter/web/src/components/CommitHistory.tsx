import React, { useEffect, useState } from "react";

/**
 * CommitHistory
 *
 * Right-rail component that lists recent `repowriter:` commits and allows
 * a rollback of a specific commit. Uses the server's /api/history endpoints.
 *
 * This component is intentionally simple and uses window.confirm and alert for
 * confirmations. It calls POST /api/history/rollback with { commitSha }.
 */

type Commit = {
  sha: string;
  date: string;
  author_name: string;
  author_email?: string;
  message: string;
};

export default function CommitHistory() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history");
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const j = await res.json();
      setCommits(Array.isArray(j.commits) ? j.commits : []);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function rollback(commitSha: string) {
    if (!confirm(`Rollback commit ${commitSha}? This will reset the repository or apply the rollback metadata.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/history/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha })
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        alert(`Rolled back commit ${commitSha}`);
        await load();
      } else {
        alert(`Rollback failed: ${body?.error ?? JSON.stringify(body)}`);
      }
    } catch (err: any) {
      alert(`Rollback error: ${String(err?.message || err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Recent repowriter commits</div>
        <button onClick={load} style={smallBtn} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#64748b" }}>Loading…</div>
      ) : error ? (
        <div style={{ color: "#ef4444" }}>{error}</div>
      ) : commits.length === 0 ? (
        <div style={{ color: "#64748b" }}>No repowriter commits found</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {commits.slice(0, 20).map((c) => (
            <li key={c.sha} style={{ padding: "8px 6px", borderRadius: 6, marginBottom: 8, background: "#fff", border: "1px solid #e6eef3" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{c.message}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    {c.sha.slice(0, 7)} • {c.date} • {c.author_name}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    onClick={() => {
                      // show commit details in an alert (simple)
                      alert(`Commit ${c.sha}\n\nAuthor: ${c.author_name} <${c.author_email ?? "?"}>\nDate: ${c.date}\n\n${c.message}`);
                    }}
                    style={smallBtn}
                  >
                    View
                  </button>

                  <button onClick={() => rollback(c.sha)} style={{ ...smallBtn, background: "#ef4444", color: "#fff" }} disabled={busy}>
                    {busy ? "Working…" : "Rollback"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Styles */
const smallBtn: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid #e6eef3",
  background: "#fff",
  cursor: "pointer",
  fontSize: 12
};

