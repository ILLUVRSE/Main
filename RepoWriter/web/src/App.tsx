import React from "react";
import Topbar from "./components/Topbar";
import CodeAssistant from "./pages/CodeAssistant";

/**
 * App root
 * - mounts the Topbar and the single-page CodeAssistant layout
 * - initial data-theme is managed by ThemeToggle, stored in localStorage
 */

export default function App(): JSX.Element {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Topbar />
      <div style={{ flex: 1 }}>
        <CodeAssistant />
      </div>
    </div>
  );
}

