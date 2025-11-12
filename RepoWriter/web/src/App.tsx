// RepoWriter/web/src/App.tsx
import React from "react";

/**
 * Explicit extension import to force Vite/ESM to pick up the .tsx Layout
 * implementation instead of the existing Layout.js.
 *
 * This avoids platform-dependent resolution (Linux is case-sensitive and
 * bundlers may prefer .js).
 */
import Layout from "./components/Layout.tsx";
import LeftRail from "./components/LeftRail.tsx";
import RightWorkspace from "./components/RightWorkspace.tsx";
import ValidationDrawer from "./components/ValidationDrawer.tsx";

export default function App(): JSX.Element {
  return <Layout LeftPanel={LeftRail} RightPanel={RightWorkspace} validation={ValidationDrawer} />;
}

