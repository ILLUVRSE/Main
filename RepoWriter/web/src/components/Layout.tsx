import React, { ReactNode } from "react";
import HeaderBar from "./HeaderBar";
import RepoTree from "./RepoTree";
import CommitHistory from "./CommitHistory";

/**
 * Layout
 *
 * Top-level responsive layout used by the CodeAssistant app.
 * - left column: RepoTree (collapsible)
 * - center: main content (children)
 * - right column: CommitHistory / ApplyResult
 *
 * The layout is intentionally simple and dependency-free; we use inline styles
 * so it works out of the box. Later we can move styles to theme.css.
 */

export default function Layout({
  children,
  repoName = "RepoWriter",
}: {
  children?: ReactNode;
  repoName?: string;
}) {
  return (
    <div style={outer}>
      <HeaderBar repoName={repoName} />
      <div style={body}>
        <aside style={leftCol}>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Repository</div>
            <RepoTree />
          </div>
        </aside>

        <main style={mainCol}>
          <div style={{ padding: 12, height: "100%", boxSizing: "border-box" }}>{children}</div>
        </main>

        <aside style={rightCol}>
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>Activity</div>
            </div>

            <CommitHistory />
          </div>
        </aside>
      </div>

      <footer style={footer}>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          RepoWriter — local dev. Use the Apply modal to commit changes. All changes are local until you push.
        </div>
      </footer>
    </div>
  );
}

/* Styles */

const outer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "#f8fafc",
  color: "#0f172a",
};

const body: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const leftCol: React.CSSProperties = {
  width: 260,
  borderRight: "1px solid #e6eef3",
  background: "#ffffff",
  overflowY: "auto",
  boxSizing: "border-box",
};

const mainCol: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  background: "transparent",
};

const rightCol: React.CSSProperties = {
  width: 340,
  borderLeft: "1px solid #e6eef3",
  background: "#ffffff",
  overflowY: "auto",
  boxSizing: "border-box",
};

const footer: React.CSSProperties = {
  padding: 8,
  borderTop: "1px solid #e6eef3",
  background: "#fff",
  fontSize: 12,
  color: "#64748b",
};

