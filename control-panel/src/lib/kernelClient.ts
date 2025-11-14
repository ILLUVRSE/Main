import config from "./config";
import type { Approval, AuditEvent, ReasoningTraceNode, SentinelVerdict, Upgrade } from "./types";

type FetchOptions = RequestInit & { searchParams?: Record<string, string> };

async function apiFetch<T>(path: string, options?: FetchOptions): Promise<T> {
  if (config.demoMode) {
    return demoFetch(path) as T;
  }

  const url = new URL(`/api/kernel${path}`, window.location.origin);
  if (options?.searchParams) {
    Object.entries(options.searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const resp = await fetch(url.toString(), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `kernel request failed (${resp.status})`);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json();
}

function demoApprovals(upgradeId: string): Approval[] {
  return [
    {
      id: `${upgradeId}-appr-1`,
      upgradeId,
      approverId: "ryan",
      approverName: "Ryan (SuperAdmin)",
      signature: "demo-signature-1",
      notes: "LGTM",
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
  ];
}

function buildDemoUpgrade(id: string, status: Upgrade["status"]): Upgrade {
  const approvals = demoApprovals(id);
  return {
    id,
    title: `Upgrade ${id}`,
    description: "Demo manifest used in development mode.",
    manifest: {
      service: "kernel",
      action: "deploy",
      image: "registry.example.com/kernel:abcdef",
    },
    manifestHash: `hash-${id}`,
    sourceBranch: "feature/safety-checks",
    author: "demo-user",
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    status,
    ciStatus: "passed",
    approvalsRequired: 3,
    approvals,
    sentinelVerdict: {
      allowed: approvals.length > 0,
      policyId: "policy-demo",
      rationale: approvals.length > 0 ? "No blocking policies" : "Awaiting approvals",
      ts: new Date().toISOString(),
    },
    reasoningTraceRootId: "trace-demo-root",
    auditTrail: [
      {
        id: `audit-${id}-1`,
        type: "upgrade.submitted",
        ts: new Date().toISOString(),
        payload: { upgradeId: id, author: "demo-user" },
      },
    ],
    emergency: false,
  };
}

function demoFetch(path: string) {
  if (path === "/upgrades") {
    return {
      upgrades: [
        buildDemoUpgrade("u-demo-1", "pending"),
        buildDemoUpgrade("u-demo-2", "active"),
        buildDemoUpgrade("u-demo-3", "applied"),
      ],
    };
  }
  if (path.startsWith("/upgrades/")) {
    const [, , upgradeId] = path.split("/");
    return { upgrade: buildDemoUpgrade(upgradeId, "pending") };
  }
  if (path.startsWith("/sentinel/")) {
    return {
      verdict: {
        allowed: true,
        policyId: "policy-demo",
        rationale: "Demo verdict",
        ts: new Date().toISOString(),
      } satisfies SentinelVerdict,
    };
  }
  if (path.startsWith("/reasoning/trace")) {
    return {
      trace: [
        { id: "node-1", type: "decision", summary: "Submit upgrade", createdAt: new Date().toISOString() },
        { id: "node-2", type: "policyCheck", summary: "SentinelNet allow", createdAt: new Date().toISOString() },
      ],
    };
  }
  if (path.startsWith("/audit")) {
    return {
      events: buildDemoUpgrade("u-demo-1", "pending").auditTrail,
    };
  }
  return {};
}

export async function listUpgrades(filter?: { status?: string }): Promise<Upgrade[]> {
  const data = await apiFetch<{ upgrades: Upgrade[] }>("/upgrades", { searchParams: filter });
  return data.upgrades;
}

export async function getUpgrade(id: string): Promise<Upgrade> {
  const data = await apiFetch<{ upgrade: Upgrade }>(`/upgrades/${id}`);
  return data.upgrade;
}

export async function approveUpgrade(upgradeId: string, payload: { approverId: string; signature: string; notes?: string; emergency?: boolean }) {
  return apiFetch(`/upgrades/${upgradeId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function applyUpgrade(upgradeId: string, payload: { emergency?: boolean; rationale?: string }) {
  return apiFetch(`/upgrades/${upgradeId}/apply`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchSentinelVerdict(upgradeId: string): Promise<SentinelVerdict | undefined> {
  const data = await apiFetch<{ verdict?: SentinelVerdict }>(`/sentinel/${upgradeId}`, { method: "GET" });
  return data.verdict;
}

export async function fetchReasoningTrace(rootId: string) {
  return apiFetch<{ trace: ReasoningTraceNode[] }>(`/reasoning/trace`, {
    searchParams: { rootId },
  });
}

export async function annotateReasoningNode(nodeId: string, body: { note: string }) {
  return apiFetch(`/reasoning/annotate/${nodeId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchAuditEvents(upgradeId: string): Promise<AuditEvent[]> {
  const data = await apiFetch<{ events: AuditEvent[] }>(`/audit`, { searchParams: { upgradeId } });
  return data.events || [];
}
