"use client";
import { useState } from "react";

export default function MultisigPage() {
  const [result, setResult] = useState<string>("");

  const handleSimulate = async () => {
    const res = await fetch("/api/multisig", {
        method: "POST",
        body: JSON.stringify({ action: "approve", proposalId: "test-proposal-id" })
    });
    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
  };

  return (
    <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Multisig Upgrades</h1>
        <p className="mb-4">This page simulates multisig upgrade actions.</p>
        <button
            onClick={handleSimulate}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
            Simulate Approval
        </button>
        {result && <pre className="mt-4 p-4 bg-gray-100 rounded">{result}</pre>}
    </div>
  );
}
