import { useState } from "react";
import { verifyDeliveryProof } from "@/lib/api";
import { DeliveryProof } from "@/lib/types";

interface OrderProofViewerProps {
  proof: DeliveryProof;
}

type ProofStatus = "idle" | "verifying" | "verified" | "error";

export function OrderProofViewer({ proof }: OrderProofViewerProps) {
  const [status, setStatus] = useState<ProofStatus>("idle");
  const [message, setMessage] = useState<string>("");

  async function handleVerify() {
    setStatus("verifying");
    setMessage("Verifying proof with SentinelNet...");
    try {
      const result = await verifyDeliveryProof(proof.id);
      if (result.verified) {
        setStatus("verified");
        setMessage("Delivery proof verified against notary root.");
      } else {
        setStatus("error");
        setMessage("Proof did not match notary root.");
      }
    } catch (error) {
      console.error("proof verification failed", error);
      setStatus("error");
      setMessage("Verification failed. Retry once network settles.");
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-brand-accent">Delivery proof</p>
          <p className="text-lg font-semibold text-white">Proof ID {proof.id}</p>
        </div>
        <button
          type="button"
          onClick={handleVerify}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-brand"
          disabled={status === "verifying"}
        >
          {status === "verifying" ? "Verifying..." : "Verify"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-2xl bg-black/60 p-4 text-xs text-slate-200">
        {JSON.stringify(proof, null, 2)}
      </pre>
      <p aria-live="polite" className={`text-sm ${status === "error" ? "text-rose-400" : "text-emerald-300"}`}>
        {message || "Verify proof to compare against notarized root."}
      </p>
    </section>
  );
}
