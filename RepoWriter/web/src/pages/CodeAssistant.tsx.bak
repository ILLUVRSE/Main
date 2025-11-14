// RepoWriter/web/src/pages/CodeAssistant.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import ContextSelector from "../components/ContextSelector";
import ValidationResults from "../components/ValidationResults";
import ClarifyDialog from "../components/ClarifyDialog";
import TaskBoard from "../components/TaskBoard";
import PatchPreview from "../components/PatchPreview";
import MonacoEditorWrapper from "../components/MonacoEditorWrapper";
import PRResult from "../components/PRResult";
import ApiStatus from "../components/ApiStatus";

type PatchObj = { path: string; content?: string; diff?: string };

export default function CodeAssistant() {
  // main state
  const [prompt, setPrompt] = useState<string>("");
  const [plan, setPlan] = useState<any | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamLog, setStreamLog] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [selectedContext, setSelectedContext] = useState<Array<{ path: string; snippet?: string; tokensEstimate?: number }>>([]);
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState<string>("");
  const [clarifySuggestions, setClarifySuggestions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedPatch, setSelectedPatch] = useState<PatchObj | null>(null);
  const [appliedResult, setAppliedResult] = useState<any | null>(null);

  useEffect(() => {
    // seed some example tasks (can be managed by TaskBoard persist)
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

  // Plan (non-stream)
  async function handlePlan() {
    setStatus("Planning...");
    setPlan(null);
    setStreamLog("");
    try {
      const p = await api.fetchPlan(prompt, [], { backend: undefined });
      setPlan(p);
      setStatus("Plan ready");
      // open first patch preview if present
      const patches = gatherPatchesFromPlan(p);
      setSelectedPatch(patches.length > 0 ? patches[0] : null);
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
              const patches = gatherPatchesFromPlan(parsed);
              setSelectedPatch(patches.length > 0 ? patches[0] : null);
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
        { backend: undefined }
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

  // Apply (dry | apply)
  async function handleApply(mode: "dry" | "apply") {
    setStatus(`${mode === "dry" ? "Dry-run" : "Applying"}...`);
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) { setStatus("No patches available to apply"); return; }
      const res = await api.applyPatches(patches, mode);
      setStatus(mode === "dry" ? "Dry-run complete" : "Apply complete");
      if (mode === "apply") setAppliedResult(res);
    } catch (err: any) {
      setStatus(`Apply failed: ${String(err?.message || err)}`);
    }
  }

  // Validate
  async function handleValidate() {
    setStatus("Validating...");
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) { setStatus("No patches to validate"); return; }
      const res = await api.validatePatches(patches);
      setValidationResult(res);
      setStatus("Validation complete");
    } catch (err: any) {
      setStatus(`Validation failed: ${String(err?.message || err)}`);
    }
  }

  // Create PR
  async function handleCreatePR() {
    setStatus("Creating PR...");
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) { setStatus("No patches to create PR from"); return; }
      const branchName = `repowriter/${Date.now()}`;
      const commitMessage = `repowriter: apply ${patches.length} files`;
      const payload = { branchName, patches, commitMessage, prBase: "main", prTitle: commitMessage, prBody: `Automated changes applied by RepoWriter for prompt:\n\n${prompt}` };
      const res = await api.createPR(payload);
      setAppliedResult(res);
      setStatus("PR created");
    } catch (err: any) {
      setStatus(`Create PR failed: ${String(err?.message || err)}`);
    }
  }

  function runTask(task: any) {
    setPrompt(task.description || "");
    setTimeout(() => handlePlan(), 60);
  }

  // Clarify helpers
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

  // UI helpers
  function renderPlanSteps(p: any) {
    if (!p || !p.steps) return <div className="muted">No plan</div>;
    return (
      <div>
        {p.steps.map((s: any, idx: number) => (
          <div key={idx} className="panel" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Step {idx + 1}</div>
            <div style={{ marginBottom: 6 }}>{s.explanation}</div>
            <div>
              {Array.isArray(s.patches) && s.patches.length > 0 ? (
                s.patches.map((pa: any, j: number) => (
                  <div key={j} className="card" style={{ marginBottom: 8, cursor: "pointer" }} onClick={() => setSelectedPatch(pa)}>
                    <div style={{ fontFamily: "monospace", fontSize: 13 }}>{pa.path}</div>
                    <div style={{ marginTop: 6, fontFamily: "monospace", whiteSpace: "pre-wrap", fontSize: 13 }}>{(pa.content ?? pa.diff ?? "").slice(0, 240)}</div>
                  </div>
                ))
              ) : (
                <div className="muted">No patches for this step</div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // derived helpers
  const patches = useMemo(() => gatherPatchesFromPlan(plan), [plan]);

  return (
    <div className="layout">
      {/* Left column: Task board + ContextSelector */}
      <div className="left panel">
        <TaskBoard tasks={tasks} onChange={setTasks} onRun={runTask} />
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Repository Context</div>
          <ContextSelector initialSelected={[]} onChange={handleContextChange} />
          <div style={{ marginTop: 8, color: "var(--muted)" }}>Context tokens estimate: {contextTokens}</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={handlePlan}>Plan</button>
            <button className="btn" onClick={handleStream} disabled={streaming}>{streaming ? "Streaming..." : "Stream"}</button>
            <button className="btn" onClick={() => handleApply("dry")} disabled={!plan}>Dry-run</button>
            <button className="btn btn-primary" onClick={() => handleApply("apply")} disabled={!plan}>Apply</button>
            <button className="btn" onClick={handleValidate} disabled={!plan}>Validate</button>
            <button className="btn" onClick={handleCreatePR} disabled={!plan}>Create PR</button>
          </div>
        </div>

        <div style={{ marginTop: 12, color: "var(--muted)" }}>
          <div style={{ fontSize: 13 }}>Status: <span style={{ fontWeight: 700 }}>{status}</span></div>

          <div style={{ marginTop: 8 }}>
            <PRResult result={appliedResult} />
          </div>
        </div>
      </div>

      {/* Right column: Prompt, streaming, plan preview, patch preview, validation */}
      <div className="right">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Prompt</div>
            <div style={{ color: "var(--muted)" }}>{status}</div>
          </div>

          <div style={{ marginTop: 8 }}>
            <MonacoEditorWrapper value={prompt} language="markdown" onChange={(v) => setPrompt(v)} height={140} />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Stream Plan</div>
              <MonacoEditorWrapper value={streamLog || "No streamed output"} language="text" readOnly height={160} />
            </div>

            <div style={{ width: 420 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Plan Preview</div>
              <div style={{ maxHeight: 420, overflow: "auto" }}>
                {plan ? renderPlanSteps(plan) : <div className="muted">No plan yet — click Plan or Stream to generate a plan.</div>}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Patch Preview</div>
            <div style={{ minHeight: 200 }}>
              {selectedPatch ? (
                <PatchPreview patch={selectedPatch} />
              ) : patches.length > 0 ? (
                <PatchPreview patch={patches[0]} />
              ) : (
                <div className="muted">Select a patch to preview its content or diff.</div>
              )}
            </div>
          </div>

          <div style={{ width: 420 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Validation</div>
            <ValidationResults patches={patches} />
            <div style={{ marginTop: 12 }}>
              <ApiStatus />
            </div>
          </div>
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

