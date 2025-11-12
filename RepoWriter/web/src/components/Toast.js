import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
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
export default function ToastContainer({ toasts, onRemove, position = "top-right", }) {
    useEffect(() => {
        // for each toast with ttl, set timeout to remove
        const timers = [];
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
    if (!toasts || toasts.length === 0)
        return null;
    const containerStyle = {
        position: "fixed",
        zIndex: 4000,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        pointerEvents: "none",
    };
    // position mapping
    const posMap = {
        "top-right": { top: 12, right: 12, bottom: "auto", left: "auto" },
        "bottom-right": { bottom: 12, right: 12, top: "auto", left: "auto" },
        "top-left": { top: 12, left: 12, bottom: "auto", right: "auto" },
        "bottom-left": { bottom: 12, left: 12, top: "auto", right: "auto" },
    };
    return (_jsx("div", { style: { ...containerStyle, ...posMap[position] }, children: toasts.map((t) => (_jsx(ToastCard, { item: t, onClose: () => onRemove(t.id) }, t.id))) }));
}
function ToastCard({ item, onClose }) {
    const tone = item.type ?? "info";
    const bg = tone === "success" ? "#10B981" :
        tone === "error" ? "#EF4444" :
            tone === "warn" ? "#F59E0B" :
                "#0ea5a3";
    const style = {
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
    const titleStyle = {
        fontWeight: 700,
        fontSize: 14,
        marginBottom: 4,
    };
    const msgStyle = {
        fontSize: 13,
        color: "rgba(255,255,255,0.95)"
    };
    return (_jsxs("div", { style: style, children: [_jsxs("div", { style: { flex: 1 }, children: [item.title && _jsx("div", { style: titleStyle, children: item.title }), _jsx("div", { style: msgStyle, children: item.message })] }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: _jsx("button", { onClick: (e) => {
                        e.stopPropagation();
                        onClose();
                    }, style: {
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.9)",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 14,
                        padding: 4,
                        lineHeight: 1,
                    }, children: "\u2715" }) })] }));
}
