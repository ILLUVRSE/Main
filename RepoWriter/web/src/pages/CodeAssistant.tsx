import React, { useEffect, useState } from "react";
import PlanStream from "../components/PlanStream";
import DiffViewer from "../components/DiffViewer";
import Editor from "../components/Editor";

type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

type PlanStep = {
  explanation: string;
  patches: PatchObj[];
};

type Plan = {
  steps: PlanStep[];
  meta?: Record<string, any>;
};

export default function CodeAssistant() {
  const [prompt, setPrompt] = useState<string>("");
  const [memory, setMemory] = useState<string>("");
  const [streamText, setStreamText] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<number>(0);
  const [selectedPatchIndex, setSelectedPatchIndex] = useState<number>(0);
  const [included, setIncluded] = useState<Record<string, boolean>>({}); // key = `${stepIdx}:${patchIdx}`
  const [status, setStatus] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    // Reset selection if plan changes
    setSelectedStep(0);
    setSelectedPatchIndex(0);
    setIncluded({});
    setApplyResult(null);
    setParsingError(null);
  }, [plan]);

  function onChunk(chunk: string) {
    setStreamText((s) => s + chunk);
  }

  function onDone() {
    // Try parse the accumulated streamText into JSON plan
    try {
      const trimmed = streamText.trim();
      // The server sends JSON fragments; try to find a JSON object in the text
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.plan) {
        setPlan(parsed.plan);
      } else if (parsed && Array.isArray((parsed as any).steps)) {
        setPlan(parsed as Plan);
      } else {
        // maybe model returned the Plan directly
        setPlan(parsed as Plan);
      }
      setParsingError(null);
    } catch (err: any) {
      setParsingError("Failed to parse streamed output as JSON plan. You can copy the raw output and inspect.");
    }
  }

  async function fetchPlan() {
    setLoading(true);
    setStatus("Fetching plan...");
    setPlan(null);
    setStreamText("");
    setParsingError(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/openai/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, memory: memory ? memory.split("\n").filter(Boolean) : [] }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
      }
      const j = await res.json();
      const p = j.plan ?? j;
      setPlan(p);
      setStatus("Plan fetched");
    } catch (err: any) {
      setStatus(`Plan failed: ${String(err?.message || err)}`);
    } finally {
      setLoading(false);
    }
  }

  function toggleInclude(stepIdx: number, patchIdx: number) {
    const key = `${stepIdx}:${patchIdx}`;
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isIncluded(stepIdx: number, patchIdx: number) {
    const key = `${stepIdx}:${patchIdx}`;
    // default: include everything if not explicitly toggled off
    if (!(key in included)) return true;
    return !!included[key];
  }

  function getSelectedPatch(): PatchObj | null {
    if (!plan || !plan.steps || plan.steps.length === 0) return null;
    const step = plan.steps[selectedStep];
    if (!step || !step.patches || step.patches.length === 0) return null;
    return step.patches[selectedPatchIndex] ?? null;
  }

  async function doApply(mode: "dry" | "apply") {
    if (!plan) {
      setStatus("No plan to apply");
      return;
    }
    const patches: PatchObj[] = [];
    plan.steps.forEach((step, sIdx) => {
      (step.patches || []).forEach((p, pIdx) => {
        if (isIncluded(sIdx, pIdx)) {
          patches.push(p);
        }
      });
    });

    if (patches.length === 0) {
      setStatus("No patches selected for apply");
      return;
    }

    setLoading(true);
    setStatus(mode === "dry" ? "Running dry-run..." : "Applying patches...");
    setApplyResult(null);
    try {
      const res = await fetch("/api/openai/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches, mode }),
      });
      const j = await res.json();
      setApplyResult(j);
      if (j.ok) {
        setStatus(mode === "dry" ? "Dry-run succeeded" : "Apply succeeded");
      } else {
        setStatus(`${mode} failed: ${j.errors ? j.errors.join("; ") : JSON.stringify(j)}`);
      }
    } catch (err: any) {
      setStatus(`Apply error: ${String(err?.message || err)}`);
    } finally {
      setLoading(false);
    }
  }

  function renderPlanOverview() {
    if (!plan) return <div>No plan yet — click Plan or use Stream.</div>;
    return (
      <div>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Plan</div>
        {plan.steps.map((step, sIdx) => (
          <div key={sIdx} style={{ border: "1px solid #e6eef3", padding: 8, borderRadius: 6, marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>
              Step {sIdx + 1}: {step.explanation}
            </div>
            <div style={{ marginTop: 8 }}>
              {step.patches && step.patches.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {step.patches.map((p, pIdx) => {
                    const key = `${sIdx}:${pIdx}`;
                    const patchLabel = p.path || `(patch ${pIdx})`;
                    return (
                      <li
                        key={key}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          padding: 6,
                          borderRadius: 4,
                          background: selectedStep === sIdx && selectedPatchIndex === pIdx ? "#f1f5f9" : "transparent",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setSelectedStep(sIdx);
                          setSelectedPatchIndex(pIdx);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isIncluded(sIdx, pIdx)}
                          onChange={() => toggleInclude(sIdx, pIdx)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#0f172a" }}>{patchLabel}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {p.content ? `content (${p.content.length} chars)` : p.diff ? "unified diff" : "unknown"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div style={{ color: "#64748b" }}>No patches in this step</div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const selectedPatch = getSelectedPatch();

  return (
    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 480px", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the code changes you want (e.g., 'Add a util/summarize.ts and tests that summarize top-level comments')"
            style={{ width: "100%", minHeight: 120, padding: 8, borderRadius: 6, border: "1px solid #e6eef3" }}
          />
          <div style={{ marginTop: 8 }}>
            <button onClick={fetchPlan} disabled={loading || !prompt.trim()}>
              {loading ? "Working…" : "Plan (sync)"}
            </button>{" "}
            <span style={{ marginLeft: 8, color: "#64748b" }}>Or stream with the Stream box below</span>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Stream Plan</div>
          <PlanStream
            prompt={prompt}
            memory={memory ? memory.split("\n").filter(Boolean) : []}
            onChunk={onChunk}
            onDone={onDone}
            onError={(err) => setStatus(String(err?.message || err))}
            startOnMount={false}
          />
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>Raw stream output</div>
            <div style={{ border: "1px solid #e6eef3", padding: 8, borderRadius: 6, minHeight: 80, whiteSpace: "pre-wrap" }}>
              {streamText || <span style={{ color: "#94a3b8" }}>No streamed output</span>}
            </div>
            {parsingError && <div style={{ color: "#ef4444", marginTop: 6 }}>{parsingError}</div>}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => doApply("dry")} disabled={loading || !plan}>
              Dry run selected
            </button>
            <button onClick={() => doApply("apply")} disabled={loading || !plan}>
              Apply selected
            </button>
            <div style={{ marginLeft: "auto", color: "#64748b" }}>{status}</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Plan Preview</div>
            {renderPlanOverview()}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Apply Result</div>
          <div style={{ border: "1px solid #e6eef3", padding: 8, borderRadius: 6, minHeight: 80, whiteSpace: "pre-wrap" }}>
            {applyResult ? <pre style={{ margin: 0 }}>{JSON.stringify(applyResult, null, 2)}</pre> : <span style={{ color: "#94a3b8" }}>No apply result yet.</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Patch Preview</div>
          {selectedPatch ? (
            <>
              <div style={{ marginBottom: 8, color: "#334155", fontWeight: 600 }}>{selectedPatch.path}</div>
              {selectedPatch.diff ? (
                <DiffViewer diff={selectedPatch.diff} height="360px" />
              ) : selectedPatch.content ? (
                <>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>New / replacement content</div>
                  <Editor value={selectedPatch.content} language={"typescript"} readOnly />
                </>
              ) : (
                <div>No preview available for this patch</div>
              )}
            </>
          ) : (
            <div style={{ color: "#64748b" }}>Select a patch to preview</div>
          )}
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Repo Browser</div>
          <div style={{ border: "1px solid #e6eef3", borderRadius: 6, padding: 8 }}>
            <a href="/repo" style={{ color: "#2563eb" }}>
              Open repo browser
            </a>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
              Use the Repo Browser to inspect files and confirm patches before applying.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

