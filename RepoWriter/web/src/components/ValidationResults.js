import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import api from "../services/api";
function shortLog(t) {
    if (!t)
        return "";
    const head = (t.stdout || "").split("\n").slice(0, 30).join("\n");
    const tail = (t.stderr || "").split("\n").slice(0, 30).join("\n");
    const out = [];
    if (head)
        out.push("STDOUT:\n" + head);
    if (tail)
        out.push("STDERR:\n" + tail);
    if (t.timedOut)
        out.push("\n[Timed out]");
    return out.join("\n\n");
}
export default function ValidationResults({ patches = [], autoRun = false, onComplete }) {
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (autoRun && patches && patches.length > 0) {
            runValidate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    async function runValidate() {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            // call client helper
            const res = await api.validatePatches(patches);
            // server may return structured sandbox result or nested object
            const payload = res?.result ?? res ?? null;
            setResult(payload);
            onComplete?.(payload);
        }
        catch (err) {
            setError(String(err?.message || err));
            setResult(null);
            onComplete?.(null);
        }
        finally {
            setRunning(false);
        }
    }
    function renderCommand(title, cmd) {
        if (!cmd) {
            return _jsx("div", { style: { color: "#666" }, children: "Not run" });
        }
        const passed = cmd.ok;
        return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }, children: [_jsx("div", { style: { fontWeight: 600 }, children: title }), _jsxs("div", { style: { color: passed ? "green" : "red", fontWeight: 600 }, children: [passed ? "OK" : "FAIL", " ", cmd.exitCode !== null ? `(exit ${cmd.exitCode})` : "", cmd.timedOut ? " (timed out)" : ""] })] }), _jsx("div", { style: { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, background: "#fafafa", padding: 8, borderRadius: 4, maxHeight: 260, overflow: "auto" }, children: shortLog(cmd) }), _jsxs("div", { style: { marginTop: 6 }, children: [_jsx("button", { onClick: () => downloadLog(`${title.toLowerCase()}-stdout.txt`, cmd.stdout || ""), children: "Download stdout" }), _jsx("button", { style: { marginLeft: 8 }, onClick: () => downloadLog(`${title.toLowerCase()}-stderr.txt`, cmd.stderr || ""), children: "Download stderr" })] })] }));
    }
    function downloadLog(filename, content) {
        const blob = new Blob([content || ""], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    return (_jsxs("div", { style: { border: "1px solid #eee", padding: 12, borderRadius: 6 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("strong", { children: "Validation" }), _jsx("div", { children: _jsx("button", { onClick: runValidate, disabled: running || !patches || patches.length === 0, children: running ? "Running..." : "Run validation" }) })] }), _jsx("div", { style: { marginTop: 8, color: "#666", fontSize: 13 }, children: "Validates patches by running typecheck, tests and linter inside an isolated sandbox. Results show truncated logs; download full logs if needed." }), error && _jsx("div", { style: { marginTop: 8, color: "red" }, children: error }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: "Summary:" }), _jsx("div", { style: { marginTop: 6, padding: 8, background: "#fff", borderRadius: 4 }, children: result ? (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("strong", { children: "Overall:" }), " ", _jsx("span", { style: { color: result.ok ? "green" : "red" }, children: result.ok ? "PASS" : "FAIL" })] }), result.tempDir ? _jsxs("div", { style: { marginTop: 6, color: "#666" }, children: ["Temp dir: ", result.tempDir] }) : null, result.logs ? _jsx("div", { style: { marginTop: 6, color: "#666", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }, children: result.logs }) : null] })) : (_jsx("div", { style: { color: "#666" }, children: "No results yet. Click \"Run validation\" to execute tests/typechecks/lint in sandbox." })) })] }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { style: { marginBottom: 8 }, children: renderCommand("Typecheck", result?.typecheck ?? null) }), _jsx("div", { style: { marginTop: 12 }, children: renderCommand("Tests", result?.tests ?? null) }), _jsx("div", { style: { marginTop: 12 }, children: renderCommand("Lint", result?.lint ?? null) })] })] })] }));
}
