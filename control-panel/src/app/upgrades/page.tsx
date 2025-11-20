"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { listUpgrades } from "../../lib/kernelClient";
import type { Upgrade } from "../../lib/types";
import { useSession } from "../../lib/auth/client";
import { MetricCard } from "@/components/MetricCard";
import { UpgradeListItem } from "@/components/UpgradeListItem";

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
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.3em] text-indigo-500">Operator Console</p>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">Kernel upgrades</h1>
            <p className="text-sm text-gray-500">Search manifests, inspect Sentinel verdicts, and act with confidence.</p>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter("pending")}
            className="self-start rounded-full border border-indigo-200 px-4 py-2 text-sm text-indigo-700 hover:border-indigo-400"
          >
            Jump to pending approvals
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total upgrades" value={upgrades.length} helper="Across all statuses" />
        <MetricCard label="Pending approvals" value={filtered.filter((u) => u.status === "pending").length} helper="Requires operator review" intent="warning" />
        <MetricCard label="Active rollouts" value={upgrades.filter((u) => u.status === "active").length} helper="Currently deploying" intent="info" />
        <MetricCard
          label="Sentinel alerts"
          value={upgrades.filter((u) => u.sentinelVerdict && u.sentinelVerdict.allowed === false).length}
          helper="Blocked by SentinelNet"
          intent="danger"
        />
      </section>

      <div className="flex flex-col space-y-3 md:flex-row md:items-center md:space-x-4 md:space-y-0">
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

      <section aria-live="polite">
        {loading ? (
          <div className="text-sm text-gray-500">Loading upgrades…</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((upgrade) => (
              <UpgradeListItem key={upgrade.id} upgrade={upgrade} />
            ))}
            {!filtered.length && (
              <div className="text-sm text-gray-500 border border-dashed rounded p-8 text-center">
                No upgrades found for current filters.
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
