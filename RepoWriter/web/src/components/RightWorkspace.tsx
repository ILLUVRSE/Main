// RepoWriter/web/src/components/RightWorkspace.tsx
import React from "react";
import CodeAssistant from "../pages/CodeAssistant.tsx";

/**
 * Right workspace wrapper.
 * Renders the existing CodeAssistant page inside the new Layout.
 * This file ensures the import path matches the case used by App.tsx
 * (avoids case-sensitivity issues on Linux).
 */
export default function RightWorkspace() {
  return (
    <div style={{ height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <CodeAssistant />
    </div>
  );
}

