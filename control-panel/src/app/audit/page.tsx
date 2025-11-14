"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchAudit, AuditSummary } from "../../lib/fetcher";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/auth/client";

export default function AuditPage() {
  const router = useRouter();
  const { session } = useSession({ redirectTo: "/login" });
  const [audit, setAudit] = useState<AuditSummary[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!session) return;
    fetchAudit().then(setAudit).catch(() => setAudit([]));
  }, [router, session]);

  const filtered = useMemo(() => {
    if (!query) return audit;
    return audit.filter((event) =>
      event.type.toLowerCase().includes(query.toLowerCase()) || event.id.includes(query),
    );
  }, [audit, query]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-4">Audit events</h2>
      <div className="mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by type or id"
          className="border rounded px-3 py-2 text-sm w-full md:w-80"
        />
      </div>
      <div className="space-y-3">
        {filtered.map(a => (
          <div key={a.id} className="bg-white p-4 rounded shadow">
            <div className="text-sm text-gray-500">{a.ts}</div>
            <div className="font-medium text-gray-800">{a.type}</div>
            <pre className="mt-2 text-xs text-gray-700 overflow-auto bg-gray-50 p-2 rounded">{JSON.stringify(a.payload, null, 2)}</pre>
          </div>
        ))}
        {!filtered.length && (
          <div className="text-sm text-gray-500 border border-dashed rounded p-4 text-center">
            No audit events match your filter.
          </div>
        )}
      </div>
    </main>
  );
}
