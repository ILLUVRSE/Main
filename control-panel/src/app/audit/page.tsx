"use client";
import { useEffect, useState } from "react";
import { fetchAudit } from "../../lib/fetcher";
import { useRouter } from "next/navigation";
import { ensureAdminSession } from "../../lib/auth";

export default function AuditPage() {
  const router = useRouter();
  const [audit, setAudit] = useState<any[]>([]);

  useEffect(() => {
    ensureAdminSession(router);
    fetchAudit().then(setAudit).catch(()=>setAudit([]));
  }, [router]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-4">Audit events</h2>
      <div className="space-y-3">
        {audit.map(a => (
          <div key={a.id} className="bg-white p-4 rounded shadow">
            <div className="text-sm text-gray-500">{a.ts}</div>
            <div className="font-medium text-gray-800">{a.type}</div>
            <pre className="mt-2 text-xs text-gray-700 overflow-auto bg-gray-50 p-2 rounded">{JSON.stringify(a.payload, null, 2)}</pre>
          </div>
        ))}
      </div>
    </main>
  );
}
