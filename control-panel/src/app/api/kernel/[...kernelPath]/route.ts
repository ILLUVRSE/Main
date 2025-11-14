import { NextRequest, NextResponse } from "next/server";

const kernelUrl = process.env.KERNEL_API_URL;
const kernelToken = process.env.KERNEL_CONTROL_PANEL_TOKEN;

function buildUpstreamUrl(pathSegments: string[], request: NextRequest) {
  if (!kernelUrl) {
    throw new Error("KERNEL_API_URL not configured");
  }
  const upstream = new URL(kernelUrl.replace(/\/$/, ""));
  upstream.pathname = `${upstream.pathname.replace(/\/$/, "")}/${pathSegments.join("/")}`;
  request.nextUrl.searchParams.forEach((value, key) => {
    upstream.searchParams.set(key, value);
  });
  return upstream;
}

export async function GET(request: NextRequest, { params }: { params: { kernelPath: string[] } }) {
  const upstream = buildUpstreamUrl(params.kernelPath, request);
  const resp = await fetch(upstream, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(kernelToken ? { authorization: `Bearer ${kernelToken}` } : {}),
    },
    cache: "no-store",
  });
  const text = await resp.text();
  return new NextResponse(text, { status: resp.status, headers: resp.headers });
}

export async function POST(request: NextRequest, { params }: { params: { kernelPath: string[] } }) {
  const upstream = buildUpstreamUrl(params.kernelPath, request);
  const body = await request.text();
  const resp = await fetch(upstream, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json",
      ...(kernelToken ? { authorization: `Bearer ${kernelToken}` } : {}),
    },
    body,
  });
  const text = await resp.text();
  return new NextResponse(text, { status: resp.status, headers: resp.headers });
}

export async function PUT(request: NextRequest, { params }: { params: { kernelPath: string[] } }) {
  const upstream = buildUpstreamUrl(params.kernelPath, request);
  const body = await request.text();
  const resp = await fetch(upstream, {
    method: "PUT",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json",
      ...(kernelToken ? { authorization: `Bearer ${kernelToken}` } : {}),
    },
    body,
  });
  const text = await resp.text();
  return new NextResponse(text, { status: resp.status, headers: resp.headers });
}
