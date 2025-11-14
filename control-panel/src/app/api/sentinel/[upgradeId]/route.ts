import { NextRequest, NextResponse } from "next/server";

const sentinelUrl = process.env.SENTINEL_URL || process.env.SENTINELNET_URL;

function demoVerdict(upgradeId: string) {
  return {
    verdict: {
      allowed: true,
      policyId: "policy-demo",
      rationale: `Demo verdict for ${upgradeId}`,
      ts: new Date().toISOString(),
    },
  };
}

export async function GET(_request: NextRequest, { params }: { params: { upgradeId: string } }) {
  if (!sentinelUrl) {
    return NextResponse.json(demoVerdict(params.upgradeId));
  }

  try {
    const payload = {
      action: "upgrade.apply",
      resource: { upgradeId: params.upgradeId },
      context: {},
    };
    const resp = await fetch(`${sentinelUrl.replace(/\/$/, "")}/sentinelnet/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json({ error: text || "sentinel_error" }, { status: resp.status });
    }
    const data = await resp.json();
    const verdict = {
      allowed: Boolean(data?.decision !== "deny"),
      policyId: data?.policyId || data?.policy?.id || "unknown",
      rationale: data?.rationale || data?.explanation || "No rationale provided",
      ts: data?.ts || new Date().toISOString(),
    };
    return NextResponse.json({ verdict });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sentinel_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
