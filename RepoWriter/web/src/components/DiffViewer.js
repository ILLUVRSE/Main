import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
export default function DiffViewer({ diff, before, after, wrap = false, height = "300px", className, }) {
    if (!diff && (before === undefined || after === undefined)) {
        return _jsx("div", { children: "No diff or content provided" });
    }
    const containerStyle = {
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 13,
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        overflow: "auto",
        background: "#0b0b0b",
        color: "#e6eef3",
        height: typeof height === "number" ? `${height}px` : height,
    };
    const lineStyle = {
        whiteSpace: wrap ? "pre-wrap" : "pre",
        padding: "6px 10px",
        margin: 0,
    };
    if (diff) {
        const lines = diff.split(/\r?\n/);
        return (_jsx("div", { style: containerStyle, className: className, children: _jsx("pre", { style: { margin: 0 }, children: lines.map((line, i) => {
                    let style = { ...lineStyle };
                    if (line.startsWith("+") && !line.startsWith("+++")) {
                        style = { ...style, background: "#04260f", color: "#9be6a7" };
                    }
                    else if (line.startsWith("-") && !line.startsWith("---")) {
                        style = { ...style, background: "#2b0b0b", color: "#fca3a3" };
                    }
                    else if (line.startsWith("@@")) {
                        style = { ...style, background: "#062a3a", color: "#9fd6ff", fontWeight: 600 };
                    }
                    else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
                        style = { ...style, background: "#101010", color: "#cbd5e1", fontWeight: 600 };
                    }
                    else {
                        style = { ...style, color: "#cbd5e1" };
                    }
                    // render with key
                    return (_jsx("div", { style: style, children: line === "" ? "\u00A0" : line }, i));
                }) }) }));
    }
    // fallback: show simple before/after stacked view
    return (_jsxs("div", { style: { display: "flex", gap: 12, alignItems: "stretch", flexDirection: "row" }, className: className, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: 12, color: "#334155", marginBottom: 6 }, children: "Before" }), _jsx("div", { style: containerStyle, children: _jsx("pre", { style: { margin: 0, padding: 8, whiteSpace: wrap ? "pre-wrap" : "pre" }, children: before }) })] }), _jsx("div", { style: { width: 12 } }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: 12, color: "#334155", marginBottom: 6 }, children: "After" }), _jsx("div", { style: containerStyle, children: _jsx("pre", { style: { margin: 0, padding: 8, whiteSpace: wrap ? "pre-wrap" : "pre" }, children: after }) })] })] }));
}
