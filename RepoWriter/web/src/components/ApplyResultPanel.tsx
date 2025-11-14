import React, { useState } from "react";

type PatchApplied = {
  path: string;
  wasCreated?: boolean;
  previousContent?: string | null;
};

export default function ApplyResultPanel({
  applyResult,
  onRefresh,
}: {
  applyResult?: any | null;
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!applyResult) {
    return (
      <div style={{ padding: 12, color: "#64748b" }}>
        No apply result yet — run a dry-run or apply to see results here.
      </div>
    );
  }

  const commitSha = applyResult?.commitSha;
  const applied: PatchApplied[] = applyResult?.applied ?? [];
  const rollbackMetadata = applyResult?.rollbackMetadata;

  async function doRollback() {
    if (!confirm("Rollback the apply? This will attempt to restore previous file contents.")) return;
    setBusy(true);
    try {
      let body: any = {};
      if (rollbackMetadata) {
        body.rollbackMetadata = rollbackMetadata;
      } else if (commitSha) {
        body.commitSha = commitSha;
      } else {
        alert("No rollback metadata or commit SHA available for this apply.");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/history/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        alert("Rollback succeeded.");
        onRefresh?.();
      } else {
        alert(`Rollback failed: ${j?.error ?? JSON.stringify(j)}`);
      }
    } catch (err: any) {
      alert(`Rollback error: ${String(err?.message || err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Apply Result</div>

      <div style={{ border: "1px solid #e6eef3", borderRadius: 8, padding: 12, background: "#fff" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Status</div>
          <div style={{ marginLeft: "auto", color: applyResult?.ok ? "#10B981" : "#EF4444", fontWeight: 700 }}>
            {applyResult?.ok ? "OK" : "Failed"}
          </div>
        </div>

        {commitSha && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Commit</div>
            <div style={{ fontWeight: 700 }}>{String(commitSha)}</div>
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Files changed</div>
          {applied.length === 0 ? (
            <div style={{ color: "#64748b" }}>No files changed</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 12 }}>
              {applied.map((a, i) => (
                <li key={i} style={{ padding: "6px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ fontWeight: 700 }}>{a.path}</div>
                    <div style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
                      {a.wasCreated ? "created" : "modified"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Logs / details</div>
          <div style={{ background: "#0b0b0b", color: "#d1fae5", padding: 8, borderRadius: 6, maxHeight: 160, overflow: "auto", fontFamily: "Menlo, Monaco, monospace", fontSize: 12 }}>
            <div><strong>stdout</strong></div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{String(applyResult?.stdout ?? "")}</pre>
            <div style={{ height: 8 }} />
            <div><strong>stderr</strong></div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#ffd6d6" }}>{String(applyResult?.stderr ?? "")}</pre>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={doRollback} style={{ padding: "8px 12px", borderRadius: 8, background: "#ef4444", color: "#fff", border: "none" }} disabled={busy}>
            {busy ? "Rolling back…" : "Rollback"}
          </button>

          <button
            onClick={() => {
              // show raw result in a new window for debugging
              const w = window.open();
              if (w) {
                w.document.title = "Apply result";
                w.document.body.style.whiteSpace = "pre-wrap";
                w.document.body.innerText = JSON.stringify(applyResult, null, 2);
              }
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e6eef3", background: "#fff" }}
          >
            View raw
          </button>
        </div>
      </div>
    </div>
  );
}

