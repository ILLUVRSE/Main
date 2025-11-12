// RepoWriter/web/src/components/ValidationDrawer.tsx
import React from "react";
import ValidationResults from "./ValidationResults.tsx";

/**
 * Minimal validation drawer — a compact slide-over style panel that renders
 * the ValidationResults component. Keep this thin; UI placement only.
 */
export default function ValidationDrawer() {
  return (
    <div style={{ height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Validation</strong>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* No patches initially — the drawer UI is responsible only for placement.
            ValidationResults can be wired to real patches later (or listen to events). */}
        <ValidationResults patches={[]} />
      </div>
    </div>
  );
}

