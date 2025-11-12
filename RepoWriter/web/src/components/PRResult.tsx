import React from "react";

type Props = {
  result?: {
    commitSha?: string | null;
    prUrl?: string | null;
    prNumber?: number | null;
    branch?: string | null;
  } | null;
};

export default function PRResult({ result }: Props) {
  if (!result) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div style={{ color: "var(--muted)" }}>No PR / apply result yet.</div>
      </div>
    );
  }

  const { commitSha, prUrl, prNumber, branch } = result;

  function copy(text?: string | null) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      // lightweight feedback
      // eslint-disable-next-line no-alert
      alert("Copied to clipboard");
    } catch {
      // fallback
      // eslint-disable-next-line no-alert
      alert("Copy failed");
    }
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Last apply / PR</div>

          <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text)" }}>
            <div><strong>Commit:</strong> {commitSha ? <span>{commitSha}</span> : <span className="muted">—</span>}</div>
            <div style={{ marginTop: 6 }}>
              <strong>Branch:</strong> {branch ? <span style={{ fontFamily: "monospace" }}>{branch}</span> : <span className="muted">—</span>}
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>PR:</strong>{" "}
              {prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-primary)" }}>
                  #{prNumber ?? ""} → open on GitHub
                </a>
              ) : (
                <span className="muted">No PR</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {prUrl && (
            <button
              className="btn btn-primary btn-small"
              onClick={() => {
                try {
                  window.open(prUrl, "_blank", "noopener");
                } catch {
                  // ignore
                }
              }}
            >
              Open PR
            </button>
          )}

          {commitSha && (
            <button className="btn btn-ghost btn-small" onClick={() => copy(commitSha)}>
              Copy SHA
            </button>
          )}

          {branch && (
            <button
              className="btn btn-ghost btn-small"
              onClick={() => {
                copy(branch);
              }}
            >
              Copy branch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

