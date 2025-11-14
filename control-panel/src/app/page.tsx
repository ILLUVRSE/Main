"use client";
import { useEffect, useState } from "react";
import { fetchAgents, fetchAudit, AgentSummary, AuditSummary } from "../lib/fetcher";
import { useRouter } from "next/navigation";
import { useSession } from "../lib/auth/client";

export default function Home() {
  const router = useRouter();
  const { session } = useSession({ redirectTo: "/login" });
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [audit, setAudit] = useState<AuditSummary[]>([]);

  useEffect(() => {
    if (!session) return;
    fetchAgents().then(setAgents).catch(() => setAgents([]));
    fetchAudit().then(setAudit).catch(() => setAudit([]));
  }, [router, session]);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Agents</div>
          <div className="text-2xl font-semibold">{agents.length}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Audit events</div>
          <div className="text-2xl font-semibold">{audit.length}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Kernel URL</div>
          <div className="text-ellipsis">{process.env.NEXT_PUBLIC_KERNEL_URL || 'mock'}</div>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-semibold mb-2">Recent agents</h3>
          <ul>
            {agents.slice(0,5).map(a=>(
              <li key={a.id} className="border-b py-2">
                <div className="flex justify-between">
                  <div>{a.id}</div>
                  <div className="text-sm text-gray-500">{a.state}</div>
                </div>
                <div className="text-xs text-gray-400">{a.createdAt}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-semibold mb-2">Recent audit</h3>
          <ul>
            {audit.slice(0,5).map(a=>(
              <li key={a.id} className="border-b py-2">
                <div className="flex justify-between">
                  <div>{a.type}</div>
                  <div className="text-xs text-gray-400">{a.ts}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
