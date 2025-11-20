import { render, screen } from "@testing-library/react";
import { UpgradeListItem } from "@/components/UpgradeListItem";
import type { Upgrade } from "@/lib/types";

const baseUpgrade: Upgrade = {
  id: "u-1",
  title: "Upgrade Alpha",
  manifest: { service: "kernel", action: "deploy" },
  manifestHash: "hash1234",
  author: "demo",
  createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
  status: "pending",
  ciStatus: "passed",
  approvalsRequired: 2,
  approvals: [],
  sourceBranch: "feature/demo",
  sentinelVerdict: { allowed: true, ts: new Date().toISOString() },
};

describe("UpgradeListItem", () => {
  it("surfaces metadata", () => {
    render(<UpgradeListItem upgrade={baseUpgrade} />);
    expect(screen.getByText(/Upgrade Alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/2 approvals/i)).toBeInTheDocument();
  });

  it("shows sentinel warning when blocked", () => {
    render(<UpgradeListItem upgrade={{ ...baseUpgrade, sentinelVerdict: { allowed: false, ts: new Date().toISOString() } }} />);
    expect(screen.getByText(/Sentinel blocked/i)).toBeInTheDocument();
  });
});
