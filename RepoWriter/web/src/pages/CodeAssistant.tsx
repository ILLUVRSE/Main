// RepoWriter/web/src/pages/CodeAssistant.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import ContextSelector from "../components/ContextSelector";
import ValidationResults from "../components/ValidationResults";
import ClarifyDialog from "../components/ClarifyDialog";

type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

export default function CodeAssistant() {
  // Layout state
  const [prompt, setPrompt] = useState<string>("");
  const [plan, setPlan] = useState<any | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamLog, setStreamLog] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [selectedContext, setSelectedContext] = useState<Array<{ path: string; snippet?: string; tokensEstimate?: number }>>([]);
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [dryResult, setDryResult] = useState<any | null>(null);
  const [appliedResult, setAppliedResult] = useState<any | null>(null);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState<string>("");
  const [clarifySuggestions, setClarifySuggestions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    // Example Task Board items (you can extend this to load from storage)
    setTasks([
      { id: "t1", title: "Create hello.txt", description: 'Create "hello.txt" with "Hello from RepoWriter mock!"', created: "11/11/2025" },
      { id: "t2", title: "Add utils/summarize.ts", description: "Add a summarize util with summarize(text:string):string", created: "11/11/2025" }
    ]);
  }, []);

  // Context selector callback
  function handleContextChange(selected: Array<{ path: string; snippet?: string; tokensEstimate?: number }>, totalTokens: number) {
    setSelectedContext(selected || []);
    setContextTokens(totalTokens || 0);
  }

  // Build plan (non-streaming)
  async function handlePlan() {
    setStatus("Planning...");
    setPlan(null);
    setStreamLog("");
    try {
      const p = await api.fetchPlan(prompt, [], { backend: "openai" });
      setPlan(p);
      setStatus("Plan ready");
    } catch (err: any) {
      setStatus(`Plan failed: ${String(err?.message || err)}`);
    }
  }

  // Stream plan (SSE)
  async function handleStream() {
    setPlan(null);
    setStreamLog("");
    setStreaming(true);
    setStatus("Streaming plan...");
    try {
      await api.streamPlan(
        prompt,
        [],
        (chunk) => {
          // Append raw chunk
          setStreamLog((s) => s + chunk);
        },
        () => {
          setStreaming(false);
          setStatus("Streaming complete — attempt parsing");
          try {
            const parsed = tryExtractPlanFromStream(streamLog);
            if (parsed) {
              setPlan(parsed);
              setStatus("Plan parsed from stream");
            } else {
              setStatus("Could not parse streamed plan; check raw output");
            }
          } catch (err: any) {
            setStatus(`Stream parsing failed: ${String(err?.message || err)}`);
          }
        },
        (err) => {
          setStreaming(false);
          setStatus(`Streaming error: ${String(err?.message || err)}`);
        },
        { backend: "openai" }
      );
    } catch (err: any) {
      setStreaming(false);
      setStatus(`Streaming call failed: ${String(err?.message || err)}`);
    }
  }

  function tryExtractPlanFromStream(text: string): any | null {
    if (!text) return null;
    const replaced = text.replace(/\\n/g, "\n");
    try { return JSON.parse(replaced); } catch {}
    const first = replaced.indexOf("{");
    const last = replaced.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const cand = replaced.slice(first, last + 1);
      try { return JSON.parse(cand); } catch {}
    }
    return null;
  }

  function gatherPatchesFromPlan(p: any): PatchObj[] {
    if (!p || !p.steps) return [];
    const patches: PatchObj[] = [];
    for (const s of p.steps) {
      if (!Array.isArray(s.patches)) continue;
      for (const pa of s.patches) {
        if (pa && pa.path) {
          const patch: PatchObj = { path: pa.path };
          if (typeof pa.content === "string") patch.content = pa.content;
          if (typeof pa.diff === "string") patch.diff = pa.diff;
          patches.push(patch);
        }
      }
    }
    return patches;
  }

  async function handleApply(mode: "dry" | "apply") {
    setStatus(`${mode === "dry" ? "Dry-run" : "Applying"}...`);
    setDryResult(null);
    setAppliedResult(null);
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches available to apply");
        return;
      }
      const res = await api.applyPatches(patches, mode);
      if (mode === "dry") {
        setDryResult(res);
        setStatus("Dry-run complete");
      } else {
        setAppliedResult(res);
        setStatus("Apply complete");
      }
    } catch (err: any) {
      setStatus(`Apply failed: ${String(err?.message || err)}`);
    }
  }

  async function handleValidate() {
    setStatus("Validating...");
    setValidationResult(null);
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches to validate");
        return;
      }
      // Ensure sandbox is enabled on server if you need validate to run
      const res = await api.validatePatches(patches);
      setValidationResult(res);
      setStatus("Validation complete");
    } catch (err: any) {
      setStatus(`Validation failed: ${String(err?.message || err)}`);
    }
  }

  async function handleCreatePR() {
    setStatus("Creating PR...");
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches to create PR from");
        return;
      }
      const branchName = `repowriter/${Date.now()}`;
      const commitMessage = `repowriter: apply ${patches.length} files`;
      const payload = {
        branchName,
        patches,
        commitMessage,
        prBase: "main",
        prTitle: commitMessage,
        prBody: `Automated changes applied by RepoWriter for prompt:\n\n${prompt}`
      };
      const res = await api.createPR(payload);
      setStatus("PR created");
      setAppliedResult(res);
    } catch (err: any) {
      setStatus(`Create PR failed: ${String(err?.message || err)}`);
    }
  }

  // Task Board actions (simple, local state)
  function runTask(task: any) {
    setPrompt(task.description);
    handlePlan();
  }

  // Clarify
  function openClarify(question: string, suggestions: string[] = []) {
    setClarifyQuestion(question);
    setClarifySuggestions(suggestions);
    setShowClarify(true);
  }
  function onClarifyAnswer(answer: string) {
    setShowClarify(false);
    setPrompt((p) => `${p}\n\nClarification: ${answer}`);
    handlePlan();
  }

  // UI render helpers
  function renderTaskBoard() {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Task Board</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ border: "1px solid #eee", padding: 8, borderRadius: 6, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>{t.title}</div>
              <div style={{ color: "#666", marginTop: 6 }}>{t.description}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button onClick={() => runTask(t)}>Run</button>
                <button onClick={() => { setPrompt(t.description); }}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPlanSteps(p: any) {
    if (!p || !p.steps) return <div style={{ color: "#666" }}>No plan</div>;
    return (
      <div>
        {p.steps.map((s: any, idx: number) => (
          <div key={idx} style={{ marginBottom: 12, padding: 8, border: "1px solid #f0f0f0", borderRadius: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Step {idx + 1}</div>
            <div style={{ marginBottom: 6, color: "#333" }}>{s.explanation}</div>
            <div>
              {Array.isArray(s.patches) && s.patches.length > 0 ? (
                s.patches.map((pa: any, j: number) => (
                  <div key={j} style={{ marginBottom: 8, background: "#fbfbfb", padding: 8, borderRadius: 4 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 13 }}>{pa.path}</div>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, marginTop: 6 }}>{pa.content ?? pa.diff ?? ""}</pre>
                  </div>
                ))
              ) : (
                <div style={{ color: "#777" }}>No patches for this step</div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Main layout
  return (
    <div style={{ display: "flex", height: "100vh", gap: 12, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }}>
      {/* Left: Task board + ContextSelector (collapsible region) */}
      <div style={{ width: 320, borderRight: "1px solid #e6e6e6", overflow: "auto", background: "#f7f8f9" }}>
        {renderTaskBoard()}
        <div style={{ padding: 12, borderTop: "1px solid #eee" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Repository Context</div>
          <ContextSelector initialSelected={[]} onChange={handleContextChange} />
          <div style={{ marginTop: 8, color: "#666" }}>Context tokens estimate: {contextTokens}</div>
        </div>
      </div>

      {/* Center: Prompt / Stream / Plan */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Prompt</div>
          <div style={{ color: "#666" }}>{status}</div>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Describe what you want to change..."
          style={{ width: "100%", fontFamily: "monospace", padding: 8, fontSize: 13, borderRadius: 6, border: "1px solid #e6e6e6" }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handlePlan}>Plan</button>
          <button onClick={handleStream} disabled={streaming}>{streaming ? "Streaming..." : "Stream"}</button>
          <button onClick={() => handleApply("dry")} disabled={!plan}>Dry-run</button>
          <button onClick={() => handleApply("apply")} disabled={!plan}>Apply</button>
          <button onClick={handleValidate} disabled={!plan}>Validate</button>
          <button onClick={handleCreatePR} disabled={!plan}>Create PR</button>
        </div>

        <div style={{ flex: 1, display: "flex", gap: 12, overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 12, background: "#fff" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Stream Plan</div>
            <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", background: "#0b0b0b", color: "#0f0", padding: 8, borderRadius: 4, minHeight: 120 }}>{streamLog || "No streamed output"}</div>

            <div style={{ fontWeight: 700, marginTop: 12 }}>Plan Preview</div>
            <div style={{ marginTop: 8 }}>{plan ? renderPlanSteps(plan) : <div style={{ color: "#666" }}>No plan yet — click Plan or Stream to generate a plan.</div>}</div>
          </div>

          <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>Validation</div>
              <div style={{ marginTop: 8 }}>
                <ValidationResults patches={gatherPatchesFromPlan(plan)} autoRun={false} onComplete={(r) => setValidationResult(r)} />
              </div>
            </div>

            <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>Applied / PR result</div>
              <div style={{ marginTop: 8 }}>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>{JSON.stringify(appliedResult || {}, null, 2)}</pre>
              </div>
            </div>

            <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>Patch Preview</div>
              <div style={{ marginTop: 8, fontFamily: "monospace", whiteSpace: "pre-wrap", minHeight: 120 }}>
                {plan && plan.steps && plan.steps.length > 0 ? (
                  <div>
                    <div style={{ color: "#666" }}>Select a step on the left to preview (click in the plan).</div>
                  </div>
                ) : (
                  <div style={{ color: "#666" }}>No patches to preview</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Tools & Status */}
      <div style={{ width: 320, borderLeft: "1px solid #e6e6e6", padding: 12, background: "#f7f8f9", overflow: "auto" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Repo Tools</div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#666", marginBottom: 6 }}>Repository actions</div>
          <button onClick={async () => { const res = await api.listRepoFiles("**/*.*"); alert(`Files: ${res.length}`); }}>Open repo browser</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>Status</div>
          <div style={{ marginTop: 6, color: "#333" }}>{status}</div>
        </div>
      </div>

      <ClarifyDialog
        open={showClarify}
        question={clarifyQuestion}
        suggestions={clarifySuggestions}
        onAnswer={onClarifyAnswer}
        onCancel={() => setShowClarify(false)}
      />
    </div>
  );
}

