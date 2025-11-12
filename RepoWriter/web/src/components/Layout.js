import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
export default function Layout({ children, repoName = "RepoWriter", }) {
    return (_jsxs("div", { style: outer, children: [_jsx(HeaderBar, { repoName: repoName }), _jsxs("div", { style: body, children: [_jsx("aside", { style: leftCol, children: _jsxs("div", { style: { padding: 12 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 8 }, children: "Repository" }), _jsx(RepoTree, {})] }) }), _jsx("main", { style: mainCol, children: _jsx("div", { style: { padding: 12, height: "100%", boxSizing: "border-box" }, children: children }) }), _jsx("aside", { style: rightCol, children: _jsxs("div", { style: { padding: 12 }, children: [_jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }, children: _jsx("div", { style: { fontWeight: 700 }, children: "Activity" }) }), _jsx(CommitHistory, {})] }) })] }), _jsx("footer", { style: footer, children: _jsx("div", { style: { fontSize: 12, color: "#64748b" }, children: "RepoWriter \u2014 local dev. Use the Apply modal to commit changes. All changes are local until you push." }) })] }));
}
/* Styles */
const outer = {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
};
const body = {
    display: "flex",
    flex: 1,
    overflow: "hidden",
};
const leftCol = {
    width: 260,
    borderRight: "1px solid #e6eef3",
    background: "#ffffff",
    overflowY: "auto",
    boxSizing: "border-box",
};
const mainCol = {
    flex: 1,
    overflowY: "auto",
    background: "transparent",
};
const rightCol = {
    width: 340,
    borderLeft: "1px solid #e6eef3",
    background: "#ffffff",
    overflowY: "auto",
    boxSizing: "border-box",
};
const footer = {
    padding: 8,
    borderTop: "1px solid #e6eef3",
    background: "#fff",
    fontSize: 12,
    color: "#64748b",
};
