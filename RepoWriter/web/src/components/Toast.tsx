import React, { useEffect } from "react";

export type ToastType = "info" | "success" | "error" | "warn";

export type ToastItem = {
  id: string;
  title?: string;
  message: string;
  type?: ToastType;
  ttlMs?: number; // time to live in ms
};

/**
 * ToastContainer
 *
 * Presentational component that renders a stack of toasts in the top-right corner.
 * Parent controls the list and removal; this component only shows animations and
 * calls onRemove when a toast's implicit timeout expires.
 *
 * Usage:
 *  <ToastContainer toasts={toasts} onRemove={(id) => setToasts(t => t.filter(x=>x.id!==id))} />
 */
export default function ToastContainer({
  toasts,
  onRemove,
  position = "top-right",
}: {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
  position?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
}) {
  useEffect(() => {
    // for each toast with ttl, set timeout to remove
    const timers: Array<{ id: string; t: number }> = [];
    for (const t of toasts) {
      if (t.ttlMs && t.ttlMs > 0) {
        const timer = window.setTimeout(() => {
          onRemove(t.id);
        }, t.ttlMs);
        timers.push({ id: t.id, t: timer });
      }
    }
    return () => {
      for (const it of timers) {
        clearTimeout(it.t);
      }
    };
  }, [toasts, onRemove]);

  if (!toasts || toasts.length === 0) return null;

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 4000,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    pointerEvents: "none",
  };

  // position mapping
  const posMap: Record<string, React.CSSProperties> = {
    "top-right": { top: 12, right: 12, bottom: "auto", left: "auto" },
    "bottom-right": { bottom: 12, right: 12, top: "auto", left: "auto" },
    "top-left": { top: 12, left: 12, bottom: "auto", right: "auto" },
    "bottom-left": { bottom: 12, left: 12, top: "auto", right: "auto" },
  };

  return (
    <div style={{ ...containerStyle, ...posMap[position] }}>
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onClose={() => onRemove(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const tone = item.type ?? "info";
  const bg =
    tone === "success" ? "#10B981" :
    tone === "error" ? "#EF4444" :
    tone === "warn" ? "#F59E0B" :
    "#0ea5a3";

  const style: React.CSSProperties = {
    pointerEvents: "auto",
    minWidth: 260,
    maxWidth: 420,
    color: "#fff",
    background: bg,
    padding: "10px 12px",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(10,20,30,0.12)",
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto",
    lineHeight: 1.2,
    overflow: "hidden",
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 14,
    marginBottom: 4,
  };

  const msgStyle: React.CSSProperties = {
    fontSize: 13,
    color: "rgba(255,255,255,0.95)"
  };

  return (
    <div style={style}>
      <div style={{ flex: 1 }}>
        {item.title && <div style={titleStyle}>{item.title}</div>}
        <div style={msgStyle}>{item.message}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.9)",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 14,
            padding: 4,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

