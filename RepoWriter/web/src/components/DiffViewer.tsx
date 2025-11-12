// RepoWriter/web/src/components/DiffViewer.tsx
import React, { useEffect, useRef } from "react";
import "diff2html/bundles/css/diff2html.min.css";

/**
 * Robust DiffViewer that dynamically imports diff2html and handles
 * different module export shapes (named export, default export, or namespace).
 *
 * This avoids the runtime error: "doesn't provide an export named: 'Diff2Html'"
 * which can happen depending on how the package is bundled / resolved by Vite.
 */

type Props = {
  diff?: string;
  sideBySide?: boolean;
  className?: string;
};

export default function DiffViewer({ diff = "", sideBySide = true, className }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    if (!diff || diff.trim().length === 0) {
      rootRef.current.innerHTML = `<div style="padding:12px;color:var(--muted)">No diff to display</div>`;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // dynamic import so we can adapt to multiple export shapes
        // (named export, default export, or the module object)
        const mod: any = await import("diff2html");
        // prefer named export, then default, then module itself
        const D = mod?.Diff2Html ?? mod?.default ?? mod;

        if (!D || typeof D.getPrettyHtml !== "function") {
          throw new Error("diff2html: no getPrettyHtml() available on module");
        }

        const html = D.getPrettyHtml(diff, {
          inputFormat: "diff",
          outputFormat: sideBySide ? "side-by-side" : "line-by-line",
          drawFileList: false,
          matching: "lines",
          synchronisedScroll: true,
          highlight: true,
        });

        if (cancelled || !rootRef.current) return;
        // Insert generated HTML
        rootRef.current.innerHTML = html;

        // Small tweak: ensure monospaced font in code areas (defensive)
        const codeBlocks = rootRef.current.querySelectorAll(".d2h-code");
        codeBlocks.forEach((el) => {
          (el as HTMLElement).style.fontFamily = "var(--mono)";
          (el as HTMLElement).style.fontSize = "13px";
        });
      } catch (err: any) {
        if (!rootRef.current) return;
        rootRef.current.innerHTML = `<pre style="padding:12px;color:var(--danger);white-space:pre-wrap">Failed to render diff: ${String(
          err?.message ?? err
        )}</pre>`;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [diff, sideBySide]);

  function downloadPatch() {
    const blob = new Blob([diff || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "patch.diff";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div className={className}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>Diff</strong>
        <div>
          <button className="btn btn-ghost btn-small" onClick={downloadPatch} style={{ marginRight: 8 }}>
            Download
          </button>
        </div>
      </div>

      <div ref={rootRef} style={{ borderRadius: 8, overflow: "auto", border: "1px solid rgba(0,0,0,0.06)" }} />
    </div>
  );
}

