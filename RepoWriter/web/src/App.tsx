import React, { useState } from "react";
import axios from "axios";
const API = import.meta.env.VITE_API_URL;

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [status, setStatus] = useState<string>("");

  async function makePlan() {
    setStatus("planning...");
    const { data } = await axios.post(`${API}/api/openai/plan`, { prompt, memory: [] });
    setPlan(data.plan);
    setStatus("plan ready");
  }

  async function applyPlan() {
    if (!plan?.patches?.length) return;
    setStatus("applying...");
    const { data } = await axios.post(`${API}/api/openai/apply`, { patches: plan.patches, mode: "apply" });
    setStatus(`applied ${data.results?.length || 0} files`);
  }

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>RepoWriter</h2>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what you want to change. Narrative allowed."
        rows={6}
        style={{ width: "100%" }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={makePlan}>Plan</button>
        <button onClick={applyPlan} disabled={!plan}>Apply</button>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{status}</pre>
      <pre style={{ background: "#111", color: "#0f0", padding: 8, overflowX: "auto" }}>
        {JSON.stringify(plan, null, 2)}
      </pre>
    </div>
  );
}

