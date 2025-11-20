import Link from "next/link";
import type { Upgrade } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export function UpgradeListItem({ upgrade }: { upgrade: Upgrade }) {
  const sentinelBlocked = upgrade.sentinelVerdict && upgrade.sentinelVerdict.allowed === false;
  return (
    <Link
      data-testid="upgrade-card"
      href={`/upgrades/${upgrade.id}`}
      className="block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-indigo-200"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{upgrade.title}</h3>
          <div className="text-xs text-gray-500">
            {upgrade.id} • submitted by {upgrade.author} • {new Date(upgrade.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <StatusBadge status={upgrade.status} />
          <span className="uppercase tracking-wide">CI: {upgrade.ciStatus.toUpperCase()}</span>
          <span>
            {upgrade.approvals.length}/{upgrade.approvalsRequired} approvals
          </span>
          {sentinelBlocked && <span className="text-rose-600">Sentinel blocked</span>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
        {upgrade.sourceBranch && <span className="rounded-full border border-gray-200 px-3 py-1">Branch {upgrade.sourceBranch}</span>}
        <span className="rounded-full border border-gray-200 px-3 py-1">Manifest {upgrade.manifestHash.slice(0, 8)}</span>
      </div>
    </Link>
  );
}
