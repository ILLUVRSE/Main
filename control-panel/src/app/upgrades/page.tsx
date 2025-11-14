"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listUpgrades } from "../../lib/kernelClient";
import type { Upgrade } from "../../lib/types";
import { useSession } from "../../lib/auth/client";

const STATUS_OPTIONS = ["all", "pending", "active", "applied", "failed"];

export default function UpgradesPage() {
  const { session } = useSession({ redirectTo: "/login" });
  const [upgrades, setUpgrades] = useState<Upgrade[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    startTransition(() => setLoading(true));
    listUpgrades({ status: statusFilter === "all" ? undefined : statusFilter })
      .then((data) => {
        setUpgrades(data);
        setError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load upgrades";
        setError(message);
      })
      .finally(() => startTransition(() => setLoading(false)));
  }, [session, statusFilter]);

  const filtered = useMemo(() => {
    return upgrades.filter((upgrade) => {
      if (statusFilter !== "all" && upgrade.status !== statusFilter) {
        return false;
      }
      if (search && !upgrade.title.toLowerCase().includes(search.toLowerCase()) && !upgrade.id.includes(search)) {
        return false;
      }
      return true;
    });
  }, [upgrades, statusFilter, search]);

  if (!session) {
    return null;
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Upgrades</h1>
          <p className="text-sm text-gray-500">Review, approve, and apply Kernel upgrades.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-3 md:space-y-0">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All statuses" : option}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search upgrades"
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-sm text-red-600 px-4 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading upgrades…</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((upgrade) => (
            <Link
              key={upgrade.id}
              href={`/upgrades/${upgrade.id}`}
              className="block border rounded-lg bg-white shadow-sm hover:border-indigo-300 transition"
            >
              <div className="p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{upgrade.title}</h3>
                  <div className="text-xs text-gray-500">
                    {upgrade.id} • submitted by {upgrade.author} • {new Date(upgrade.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <StatusBadge status={upgrade.status} />
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    CI: {upgrade.ciStatus.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {upgrade.approvals.length}/{upgrade.approvalsRequired} approvals
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {!filtered.length && (
            <div className="text-sm text-gray-500 border border-dashed rounded p-8 text-center">
              No upgrades found for current filters.
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    active: "bg-blue-100 text-blue-800",
    applied: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    rejected: "bg-gray-200 text-gray-700",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}
