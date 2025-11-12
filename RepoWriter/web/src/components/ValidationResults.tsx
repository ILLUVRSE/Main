import React, { useEffect, useState } from "react";
import api from "../services/api";

type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

type SandboxResult = {
  ok: boolean;
  tests?: CommandResult;
  typecheck?: CommandResult;
  lint?: CommandResult;
  error?: string;
  tempDir?: string | null;
  logs?: string;
};

type Props = {
  /**
   * Patches to validate. If omitted, UI will run nothing.
   */
  patches?: PatchObj[];

  /**
   * Whether to auto-run validation on mount.
   */
  autoRun?: boolean;

  /**
   * Called when a validation completes (passes or fails)
   */
  onComplete?: (result: SandboxResult | null) => void;
};

function shortLog(t?: CommandResult | null) {
  if (!t) return "";
  const head = (t.stdout || "").split("\n").slice(0, 30).join("\n");
  const tail = (t.stderr || "").split("\n").slice(0, 30).join("\n");
  const out = [];
  if (head) out.push("STDOUT:\n" + head);
  if (tail) out.push("STDERR:\n" + tail);
  if (t.timedOut) out.push("\n[Timed out]");
  return out.join("\n\n");
}

export default function ValidationResults({ patches = [], autoRun = false, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const payload: SandboxResult = res?.result ?? res ?? null;
      setResult(payload);
      onComplete?.(payload);
    } catch (err: any) {
      setError(String(err?.message || err));
      setResult(null);
      onComplete?.(null);
    } finally {
      setRunning(false);
    }
  }

  function renderCommand(title: string, cmd?: CommandResult | null) {
    if (!cmd) {
      return <div style={{ color: "#666" }}>Not run</div>;
    }
    const passed = cmd.ok;
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div style={{ color: passed ? "green" : "red", fontWeight: 600 }}>
            {passed ? "OK" : "FAIL"} {cmd.exitCode !== null ? `(exit ${cmd.exitCode})` : ""}
            {cmd.timedOut ? " (timed out)" : ""}
          </div>
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, background: "#fafafa", padding: 8, borderRadius: 4, maxHeight: 260, overflow: "auto" }}>
          {shortLog(cmd)}
        </div>
        <div style={{ marginTop: 6 }}>
          <button onClick={() => downloadLog(`${title.toLowerCase()}-stdout.txt`, cmd.stdout || "")}>Download stdout</button>
          <button style={{ marginLeft: 8 }} onClick={() => downloadLog(`${title.toLowerCase()}-stderr.txt`, cmd.stderr || "")}>Download stderr</button>
        </div>
      </div>
    );
  }

  function downloadLog(filename: string, content: string) {
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

  return (
    <div style={{ border: "1px solid #eee", padding: 12, borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Validation</strong>
        <div>
          <button onClick={runValidate} disabled={running || !patches || patches.length === 0}>{running ? "Running..." : "Run validation"}</button>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
        Validates patches by running typecheck, tests and linter inside an isolated sandbox. Results show truncated logs; download full logs if needed.
      </div>

      {error && <div style={{ marginTop: 8, color: "red" }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <strong>Summary:</strong>
          <div style={{ marginTop: 6, padding: 8, background: "#fff", borderRadius: 4 }}>
            {result ? (
              <>
                <div><strong>Overall:</strong> <span style={{ color: result.ok ? "green" : "red" }}>{result.ok ? "PASS" : "FAIL"}</span></div>
                {result.tempDir ? <div style={{ marginTop: 6, color: "#666" }}>Temp dir: {result.tempDir}</div> : null}
                {result.logs ? <div style={{ marginTop: 6, color: "#666", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>{result.logs}</div> : null}
              </>
            ) : (
              <div style={{ color: "#666" }}>No results yet. Click "Run validation" to execute tests/typechecks/lint in sandbox.</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            {renderCommand("Typecheck", result?.typecheck ?? null)}
          </div>

          <div style={{ marginTop: 12 }}>
            {renderCommand("Tests", result?.tests ?? null)}
          </div>

          <div style={{ marginTop: 12 }}>
            {renderCommand("Lint", result?.lint ?? null)}
          </div>
        </div>
      </div>
    </div>
  );
}

