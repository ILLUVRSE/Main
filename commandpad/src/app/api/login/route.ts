import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const password = body?.password;
    const ADMIN = process.env.ADMIN_PASSWORD || "changeme";
    if (password && password === ADMIN) {
      return NextResponse.json({ ok: true }, { status: 200 });
    } else {
      return NextResponse.json({ error: "invalid password" }, { status: 401 });
    }
  } catch (e) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}

