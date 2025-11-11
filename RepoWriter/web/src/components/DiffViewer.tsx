import React from "react";

type DiffViewerProps = {
  diff?: string; // unified diff text
  before?: string; // optional original file content
  after?: string; // optional new file content
  wrap?: boolean; // whether to wrap long lines
  height?: string | number;
  className?: string;
};

/**
 * Simple unified-diff renderer.
 *
 * - If `diff` is provided we render it with colored lines:
 *     + lines in green
 *     - lines in red
 *     @@ hunks in blue
 *     other lines in monospace
 *
 * - If `before` and `after` are provided (and no diff), render a compact side-by-side
 *   view by showing labels and the two contents.
 *
 * This component intentionally avoids heavy dependencies to remain easy to drop in.
 */
export default function DiffViewer({
  diff,
  before,
  after,
  wrap = false,
  height = "300px",
  className,
}: DiffViewerProps) {
  if (!diff && (before === undefined || after === undefined)) {
    return <div>No diff or content provided</div>;
  }

  const containerStyle: React.CSSProperties = {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    overflow: "auto",
    background: "#0b0b0b",
    color: "#e6eef3",
    height: typeof height === "number" ? `${height}px` : height,
  };

  const lineStyle: React.CSSProperties = {
    whiteSpace: wrap ? "pre-wrap" : "pre",
    padding: "6px 10px",
    margin: 0,
  };

  if (diff) {
    const lines = diff.split(/\r?\n/);
    return (
      <div style={containerStyle} className={className}>
        <pre style={{ margin: 0 }}>
          {lines.map((line, i) => {
            let style: React.CSSProperties = { ...lineStyle };
            if (line.startsWith("+") && !line.startsWith("+++")) {
              style = { ...style, background: "#04260f", color: "#9be6a7" };
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              style = { ...style, background: "#2b0b0b", color: "#fca3a3" };
            } else if (line.startsWith("@@")) {
              style = { ...style, background: "#062a3a", color: "#9fd6ff", fontWeight: 600 };
            } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
              style = { ...style, background: "#101010", color: "#cbd5e1", fontWeight: 600 };
            } else {
              style = { ...style, color: "#cbd5e1" };
            }
            // render with key
            return (
              <div key={i} style={style}>
                {line === "" ? "\u00A0" : line}
              </div>
            );
          })}
        </pre>
      </div>
    );
  }

  // fallback: show simple before/after stacked view
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexDirection: "row" }} className={className}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>Before</div>
        <div style={containerStyle}>
          <pre style={{ margin: 0, padding: 8, whiteSpace: wrap ? "pre-wrap" : "pre" }}>{before}</pre>
        </div>
      </div>
      <div style={{ width: 12 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>After</div>
        <div style={containerStyle}>
          <pre style={{ margin: 0, padding: 8, whiteSpace: wrap ? "pre-wrap" : "pre" }}>{after}</pre>
        </div>
      </div>
    </div>
  );
}

