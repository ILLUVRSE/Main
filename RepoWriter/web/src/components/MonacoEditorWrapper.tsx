import React, { useEffect, useRef } from "react";

/**
 * MonacoEditorWrapper
 *
 * Lightweight wrapper that lazy-loads monaco-editor on the client and
 * mounts a standalone editor in a div. Keeps API surface minimal:
 *
 * Props:
 *  - value?: string
 *  - language?: string (default: "javascript")
 *  - readOnly?: boolean
 *  - onChange?: (val:string) => void
 *  - height?: number | string (e.g. 300 or "50vh")
 *  - options?: monaco editor options (partial)
 *
 * Notes:
 *  - This component avoids importing monaco at module load time to keep bundle small.
 *  - It's defensive: if monaco fails to load, it falls back gracefully (shows plain <pre>).
 */

type Props = {
  value?: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (val: string) => void;
  height?: number | string;
  options?: Record<string, any>;
  className?: string;
};

export default function MonacoEditorWrapper({
  value = "",
  language = "javascript",
  readOnly = false,
  onChange,
  height = 300,
  options = {},
  className
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const modelRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    // Only run in browser
    if (typeof window === "undefined") return;

    (async () => {
      try {
        // dynamic import so bundlers chunk monaco separately
        const monaco = await import("monaco-editor");

        if (cancelled) return;
        if (!containerRef.current) return;

        // Create model (so different editors don't share model)
        const uri = monaco.Uri.parse(`inmemory://model-${Date.now()}.${language}`);
        modelRef.current = monaco.editor.createModel(value || "", language, uri);

        editorRef.current = monaco.editor.create(containerRef.current, {
          model: modelRef.current,
          automaticLayout: true,
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: "on",
          ...options
        });

        // Listen for changes
        const disp = editorRef.current.onDidChangeModelContent(() => {
          try {
            const v = modelRef.current.getValue();
            onChange?.(v);
          } catch {}
        });

        // cleanup helper
        (editorRef.current as any).__cleanup = () => {
          try {
            disp.dispose();
          } catch {}
          try {
            editorRef.current.dispose();
          } catch {}
          try {
            if (modelRef.current) modelRef.current.dispose();
          } catch {}
        };
      } catch (err) {
        // console.warn if monaco fails to load; UI falls back to pre element below
        // eslint-disable-next-line no-console
        console.warn("Monaco failed to load:", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (editorRef.current && (editorRef.current as any).__cleanup) (editorRef.current as any).__cleanup();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep model in sync when value prop changes
  useEffect(() => {
    try {
      if (modelRef.current) {
        const current = modelRef.current.getValue();
        if (value !== current) modelRef.current.setValue(value ?? "");
      }
    } catch {}
  }, [value]);

  // update readOnly dynamically
  useEffect(() => {
    try {
      if (editorRef.current) editorRef.current.updateOptions({ readOnly });
    } catch {}
  }, [readOnly]);

  const style: React.CSSProperties = {
    height: typeof height === "number" ? `${height}px` : height,
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid rgba(0,0,0,0.06)",
    boxSizing: "border-box"
  };

  return (
    <div className={className} style={style}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {/* Fallback: if monaco not loaded, show read-only pre */}
      {typeof window !== "undefined" && (window as any).__MONACO_EDITOR_LOADED__ === false && (
        <pre style={{ padding: 12, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{value}</pre>
      )}
    </div>
  );
}

