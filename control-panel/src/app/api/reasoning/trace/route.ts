import { NextRequest, NextResponse } from "next/server";

const reasoningUrl = process.env.REASONING_GRAPH_URL || process.env.REASONING_URL;

function demoTrace() {
  return {
    trace: [
      { id: "node-1", type: "decision", summary: "Upgrade submitted", createdAt: new Date().toISOString() },
      { id: "node-2", type: "policyCheck", summary: "SentinelNet allow", createdAt: new Date().toISOString() },
    ],
  };
}

export async function GET(request: NextRequest) {
  const rootId = request.nextUrl.searchParams.get("rootId");
  if (!rootId) {
    return NextResponse.json({ error: "rootId required" }, { status: 400 });
  }

  if (!reasoningUrl) {
    return NextResponse.json(demoTrace());
  }

  try {
    const resp = await fetch(
      `${reasoningUrl.replace(/\/$/, "")}/reason/trace/${encodeURIComponent(rootId)}?direction=ancestors&depth=5`,
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json({ error: text || "reasoning_error" }, { status: resp.status });
    }
    return NextResponse.json(await resp.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "reasoning_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
