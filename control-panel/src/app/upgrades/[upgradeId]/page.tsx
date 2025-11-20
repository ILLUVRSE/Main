"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  annotateReasoningNode,
  applyUpgrade,
  approveUpgrade,
  fetchAuditEvents,
  fetchReasoningTrace,
  fetchSentinelVerdict,
  getUpgrade,
  rejectUpgrade,
} from "../../../lib/kernelClient";
import type { AuditEvent, ReasoningTraceNode, Upgrade } from "../../../lib/types";
import { useSession } from "../../../lib/auth/client";
import { signApproval } from "../../../lib/signingProxy";
import { StatusBadge } from "@/components/StatusBadge";

export default function UpgradeDetailPage() {
  const params = useParams<{ upgradeId: string }>();
  const { session } = useSession({ redirectTo: "/login" });
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const [trace, setTrace] = useState<ReasoningTraceNode[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [sentinelVerdict, setSentinelVerdict] = useState<Awaited<ReturnType<typeof fetchSentinelVerdict>> | null>(null);
  const sentinelBlocked = sentinelVerdict && sentinelVerdict.allowed === false;
  const [notes, setNotes] = useState("");
  const [ratificationNotes, setRatificationNotes] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [ratifying, setRatifying] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const [selectedNode, setSelectedNode] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      setLoading(true);
      try {
        const upgradeData = await getUpgrade(params.upgradeId);
        setUpgrade(upgradeData);
        setSentinelVerdict((await fetchSentinelVerdict(params.upgradeId)) ?? null);
        if (upgradeData.reasoningTraceRootId) {
        const traceResponse = await fetchReasoningTrace(upgradeData.reasoningTraceRootId);
        setTrace(traceResponse.trace || []);
        }
        setAudit(await fetchAuditEvents(params.upgradeId));
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load upgrade";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.upgradeId, session]);

  const approvalsRemaining = useMemo(() => {
    if (!upgrade) return 0;
    return Math.max(0, upgrade.approvalsRequired - upgrade.approvals.length);
  }, [upgrade]);

  async function handleApprove() {
    if (!upgrade || !session) return;
    setApproving(true);
    try {
      const signature = await signApproval({
        upgradeId: upgrade.id,
        manifestHash: upgrade.manifestHash,
        approverId: session.sub,
        approverRole: session.roles[0],
        notes,
      });
      await approveUpgrade(upgrade.id, {
        approverId: session.sub,
        signature,
        notes,
      });
      setNotes("");
      const updated = await getUpgrade(upgrade.id);
      setUpgrade(updated);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Approval failed";
      setError(message);
    } finally {
      setApproving(false);
    }
  }

  async function handleRatify() {
    if (!upgrade || !session) return;
    setRatifying(true);
    try {
      const signature = await signApproval({
        upgradeId: upgrade.id,
        manifestHash: upgrade.manifestHash,
        approverId: session.sub,
        approverRole: session.roles[0],
        notes: ratificationNotes,
        emergency: true,
      });
      await approveUpgrade(upgrade.id, {
        approverId: session.sub,
        signature,
        notes: ratificationNotes,
        emergency: true,
      });
      setRatificationNotes("");
      const updated = await getUpgrade(upgrade.id);
      setUpgrade(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ratification failed";
      setError(message);
    } finally {
      setRatifying(false);
    }
  }

  async function handleApply(emergency = false) {
    if (!upgrade) return;
    setApplying(true);
    try {
      await applyUpgrade(upgrade.id, { emergency, rationale: emergency ? emergencyReason : undefined });
      const updated = await getUpgrade(upgrade.id);
      setUpgrade(updated);
      setEmergencyReason("");
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setError(message);
    } finally {
      setApplying(false);
    }
  }

  async function submitAnnotation() {
    if (!selectedNode || !annotation) return;
    try {
      await annotateReasoningNode(selectedNode, { note: annotation });
      setAnnotation("");
      setSelectedNode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save annotation";
      setError(message);
    }
  }

  if (!session) {
    return null;
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading upgrade…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }

  if (!upgrade) {
    return <div className="p-6 text-sm text-gray-500">Upgrade not found.</div>;
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{upgrade.title}</h1>
          <p className="text-sm text-gray-500">
            Upgrade {upgrade.id} • submitted by {upgrade.author} on{" "}
            {new Date(upgrade.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <StatusBadge status={upgrade.status} />
          <span className="text-xs text-gray-600">
            {upgrade.approvals.length}/{upgrade.approvalsRequired} approvals
          </span>
        </div>
      </div>

      {sentinelVerdict && (
        <div className={`rounded border px-4 py-3 ${sentinelVerdict.allowed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <div className="text-sm font-semibold">
            SentinelNet verdict: {sentinelVerdict.allowed ? "ALLOW" : "BLOCK"}
          </div>
          <div className="text-xs text-gray-600">
            Policy {sentinelVerdict.policyId || "unknown"} — {sentinelVerdict.rationale || "n/a"}
          </div>
          {!sentinelVerdict.allowed && (
            <div className="text-xs text-red-700 mt-2">
              Approvals and apply are disabled until SentinelNet clears this upgrade.
            </div>
          )}
        </div>
      )}

      <section className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-semibold">Manifest</h2>
          <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto">
            {JSON.stringify(upgrade.manifest, null, 2)}
          </pre>
          <div className="text-xs text-gray-500">Manifest hash: {upgrade.manifestHash}</div>
        </div>

        <div className="bg-white border rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-semibold">Approvals</h2>
          <ul className="space-y-2">
            {upgrade.approvals.map((approval) => (
              <li key={approval.id} className="border rounded px-3 py-2">
                <div className="text-sm font-semibold">{approval.approverName || approval.approverId}</div>
                <div className="text-xs text-gray-500">
                  {new Date(approval.createdAt).toLocaleString()} — {approval.notes || "No notes"}
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Approval notes"
              className="w-full text-sm border rounded px-3 py-2"
            />
            <button
              onClick={handleApprove}
              disabled={approving || sentinelBlocked}
              className="w-full bg-indigo-600 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
            >
              {approving ? "Submitting approval…" : "Approve upgrade"}
            </button>
            {sentinelBlocked && (
              <div className="text-xs text-red-600">
                SentinelNet is blocking approvals until policies pass.
              </div>
            )}
          </div>
          <div className="space-y-2 border-t pt-3">
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Rejection reason"
              className="w-full text-sm border rounded px-3 py-2"
            />
            <button
              onClick={handleReject}
              disabled={rejecting}
              className="w-full border border-red-200 text-red-700 px-4 py-2 rounded text-sm disabled:opacity-60"
            >
              {rejecting ? "Rejecting…" : "Reject upgrade"}
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">Apply</h2>
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-2 md:space-y-0">
          <button
            onClick={() => handleApply(false)}
            disabled={applying || approvalsRemaining > 0 || sentinelBlocked}
            className="bg-green-600 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
          >
            {applying ? "Applying…" : "Apply upgrade"}
          </button>
          <div className="flex-1">
            <textarea
              value={emergencyReason}
              onChange={(e) => setEmergencyReason(e.target.value)}
              placeholder="Emergency rationale"
              className="w-full text-sm border rounded px-3 py-2"
            />
            <button
              onClick={() => handleApply(true)}
              disabled={applying || !emergencyReason}
              className="mt-2 bg-red-600 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
            >
              {applying ? "Applying emergency…" : "Emergency apply"}
            </button>
          </div>
        </div>
        {approvalsRemaining > 0 && (
          <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
            {approvalsRemaining} additional approvals required before apply is enabled.
          </div>
        )}
        {sentinelBlocked && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            SentinelNet verdict is blocking apply. Resolve the policy findings or request override.
          </div>
        )}
      </section>

      {upgrade.emergency && (
        <section className="bg-white border rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-red-700">Post-emergency ratification</h2>
          <p className="text-sm text-gray-600">
            This upgrade was applied via emergency channel. Collect ratification approvals to satisfy governance after the fact.
          </p>
          <div className="space-y-2">
            <textarea
              value={ratificationNotes}
              onChange={(e) => setRatificationNotes(e.target.value)}
              placeholder="Ratification notes"
              className="w-full text-sm border rounded px-3 py-2"
            />
            <button
              onClick={handleRatify}
              disabled={ratifying || sentinelBlocked}
              className="bg-orange-600 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
            >
              {ratifying ? "Submitting ratification…" : "Submit ratification approval"}
            </button>
          </div>
        </section>
      )}

      {trace.length > 0 && (
        <section className="bg-white border rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold">Reasoning trace</h2>
          <ul className="space-y-2">
            {trace.map((node) => (
              <li key={node.id} className="border rounded px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{node.summary}</div>
                  <button
                    className="text-xs text-indigo-600"
                    onClick={() => setSelectedNode(node.id)}
                  >
                    Annotate
                  </button>
                </div>
                <div className="text-xs text-gray-500">{node.type}</div>
                <div className="text-xs text-gray-400">{new Date(node.createdAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
          {selectedNode && (
            <div className="space-y-2 border rounded px-3 py-3 bg-gray-50">
              <div className="text-xs text-gray-500">Annotating node {selectedNode}</div>
              <textarea
                value={annotation}
                onChange={(e) => setAnnotation(e.target.value)}
                className="w-full text-sm border rounded px-3 py-2"
                placeholder="Add annotation to reasoning trace"
              />
              <div className="flex space-x-3">
                <button
                  onClick={submitAnnotation}
                  className="bg-indigo-600 text-white text-sm px-3 py-2 rounded disabled:opacity-60"
                  disabled={!annotation}
                >
                  Save annotation
                </button>
                <button
                  onClick={() => {
                    setAnnotation("");
                    setSelectedNode("");
                  }}
                  className="text-sm text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">Audit trail</h2>
        <ul className="space-y-2 text-sm">
          {audit.map((event) => (
            <li key={event.id} className="border rounded px-3 py-2">
              <div className="font-semibold text-gray-800">{event.type}</div>
              <div className="text-xs text-gray-500">{new Date(event.ts).toLocaleString()}</div>
              <pre className="mt-2 text-xs bg-gray-50 p-2 rounded overflow-auto">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

  async function handleReject() {
    if (!upgrade || !session) return;
    setRejecting(true);
    try {
      await rejectUpgrade(upgrade.id, { approverId: session.sub, notes: rejectNotes });
      setRejectNotes("");
      setUpgrade(await getUpgrade(upgrade.id));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reject failed";
      setError(message);
    } finally {
      setRejecting(false);
    }
  }
