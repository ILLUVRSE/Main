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
  const [prompt, setPrompt] = useState<string>(""); // narrative prompt
  const [selectedContext, setSelectedContext] = useState<Array<{ path: string; snippet?: string; tokensEstimate?: number }>>([]);
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [plan, setPlan] = useState<any | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamLog, setStreamLog] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [dryResult, setDryResult] = useState<any | null>(null);
  const [appliedResult, setAppliedResult] = useState<any | null>(null);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState<string>("");
  const [clarifySuggestions, setClarifySuggestions] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    // initialize (optional): create a conversation id if you want multi-turn
    setConversationId(`conv-${Date.now()}`);
  }, []);

  // Handler when ContextSelector changes
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
      // Try server-side context build first (recommended)
      const contextOpts = { topK: 8, tokenBudget: 1200 };
      // server will embed context automatically if we pass nothing here; include files by path in memory if desired
      const memory: string[] = [];
      // Fetch plan
      const p = await api.fetchPlan(prompt, memory, { backend: "openai" });
      setPlan(p);
      setStatus("Plan ready");
    } catch (err: any) {
      setStatus(`Plan failed: ${String(err?.message || err)}`);
    }
  }

  // Stream plan (SSE). Streams raw JSON fragments, we accumulate into streamLog and attempt to parse final JSON.
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
          // onChunk
          try {
            // Some chunks are JSON fragments (escaped \n). Show them raw and append.
            setStreamLog((s) => s + chunk);
          } catch {
            setStreamLog((s) => s + chunk);
          }
        },
        () => {
          setStreaming(false);
          setStatus("Streaming complete — attempt parsing plan");
          // Try parse streamLog as JSON
          try {
            // The model may stream escaped JSON fragments; attempt to extract JSON
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

  // Helper to try to extract JSON plan from streaming raw text
  function tryExtractPlanFromStream(text: string): any | null {
    if (!text) return null;
    const trimmed = text.trim();
    // If the stream contains escaped \n sequences, unescape them
    const replaced = trimmed.replace(/\\n/g, "\n");
    // Try direct parse
    try {
      return JSON.parse(replaced);
    } catch {
      // Try to find first { ... } substring
      const first = replaced.indexOf("{");
      const last = replaced.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        const cand = replaced.slice(first, last + 1);
        try {
          return JSON.parse(cand);
        } catch {
          // fallback null
          return null;
        }
      }
      return null;
    }
  }

  // Apply plan (either dry or apply)
  async function handleApply(mode: "dry" | "apply") {
    setStatus(`${mode === "dry" ? "Dry-run" : "Applying"}...`);
    setDryResult(null);
    setAppliedResult(null);
    try {
      // Determine patches: use plan.patches if plan has patches; otherwise, ask user to provide patches
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches available to apply");
        return;
      }

      const res = await api.applyPatches(patches, mode);
      if (!res) {
        setStatus("Apply returned no result");
        return;
      }
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

  // Validate patches via sandbox
  async function handleValidate() {
    setStatus("Validating...");
    setValidationResult(null);
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches to validate");
        return;
      }
      const res = await api.validatePatches(patches);
      setValidationResult(res);
      setStatus("Validation complete");
    } catch (err: any) {
      setStatus(`Validation failed: ${String(err?.message || err)}`);
    }
  }

  // Create PR: will apply patches (if needed), create branch, push and open PR via createPR
  async function handleCreatePR() {
    setStatus("Creating PR...");
    try {
      const patches: PatchObj[] = gatherPatchesFromPlan(plan);
      if (!patches || patches.length === 0) {
        setStatus("No patches to create PR from");
        return;
      }
      // Prompt for branch name & commit message (simple prompt)
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
      // Show result info
      setAppliedResult(res);
    } catch (err: any) {
      setStatus(`Create PR failed: ${String(err?.message || err)}`);
    }
  }

  // Gather patches from plan object
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

  // Handle Clarifying question flow (model -> user)
  function openClarify(question: string, suggestions: string[] = []) {
    setClarifyQuestion(question);
    setClarifySuggestions(suggestions);
    setShowClarify(true);
  }

  function onClarifyAnswer(answer: string) {
    // For simplicity, append answer to prompt and re-run plan
    setShowClarify(false);
    setPrompt((p) => `${p}\n\nClarification: ${answer}`);
    // optionally auto-run planner
    handlePlan();
  }

  // Render plan steps nicely
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

  // UI layout
  return (
    <div style={{ display: "flex", gap: 12, padding: 16, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }}>
      <div style={{ width: 520 }}>
        <div style={{ marginBottom: 8 }}><strong>Prompt</strong></div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          placeholder="Describe what you want to change. Narrative allowed. Example: 'Add a util/summarize.ts that summarizes top-level comments'"
          style={{ width: "100%", fontFamily: "monospace", padding: 8, fontSize: 13, borderRadius: 6, border: "1px solid #e6e6e6" }}
        />

        <div style={{ marginTop: 10 }}>
          <strong>Repository Context</strong>
          <div style={{ marginTop: 8 }}>
            <ContextSelector initialSelected={[]} onChange={handleContextChange} />
          </div>
          <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>Context tokens estimate: {contextTokens}</div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button onClick={handlePlan}>Plan</button>
          <button onClick={handleStream} disabled={streaming}>{streaming ? "Streaming..." : "Stream"}</button>
          <button onClick={() => handleApply("dry")} disabled={!plan}>Dry-run</button>
          <button onClick={() => handleApply("apply")} disabled={!plan}>Apply</button>
          <button onClick={handleValidate} disabled={!plan}>Validate</button>
          <button onClick={handleCreatePR} disabled={!plan}>Create PR</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>Status</div>
          <div style={{ marginTop: 6, color: "#333" }}>{status}</div>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Plan</div>

        <div style={{ border: "1px solid #eee", padding: 12, borderRadius: 6, maxHeight: "78vh", overflow: "auto", background: "#fff" }}>
          <div style={{ marginBottom: 8 }}>
            {streamLog ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Streamed raw output</div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, maxHeight: 220, overflow: "auto", background: "#111", color: "#0f0", padding: 8 }}>{streamLog}</pre>
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 8 }}>
            {plan ? renderPlanSteps(plan) : <div style={{ color: "#666" }}>No plan yet. Click Plan or Stream to generate a plan.</div>}
          </div>
        </div>
      </div>

      <div style={{ width: 420 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Validation</div>
        <ValidationResults patches={gatherPatchesFromPlan(plan)} autoRun={false} onComplete={(r) => setValidationResult(r)} />

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Applied / PR result</div>
          <div style={{ background: "#fafafa", padding: 8, borderRadius: 6 }}>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>{JSON.stringify(appliedResult || {}, null, 2)}</pre>
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

