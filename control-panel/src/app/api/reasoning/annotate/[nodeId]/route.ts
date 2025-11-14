import { NextRequest, NextResponse } from "next/server";

const reasoningUrl = process.env.REASONING_GRAPH_URL || process.env.REASONING_URL;

export async function POST(request: NextRequest, { params }: { params: { nodeId: string } }) {
  const nodeId = params.nodeId;
  const body = await request.json().catch(() => ({}));

  if (!body?.note) {
    return NextResponse.json({ error: "note required" }, { status: 400 });
  }

  if (!reasoningUrl) {
    return NextResponse.json({ ok: true, note: body.note, nodeId });
  }

  try {
    const resp = await fetch(`${reasoningUrl.replace(/\/$/, "")}/reason/annotate/${encodeURIComponent(nodeId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: body.note }),
    });
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
