import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { clearSession, persistSession, Session } from "../../../lib/auth/session";

type OidcClaims = {
  sub: string;
  email?: string;
  name?: string;
  roles?: string[];
};

function mapRoles(claims: OidcClaims): string[] {
  const roleString = (claims.roles || []).concat(process.env.DEMO_DEFAULT_ROLE ? [process.env.DEMO_DEFAULT_ROLE] : []);
  const unique = Array.from(new Set(roleString.map((r) => r.toString())));
  return unique.length ? unique : ["Auditor"];
}

function validateIdToken(idToken: string | undefined): OidcClaims | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    return {
      sub: payload.sub || payload.email || "user",
      email: payload.email,
      name: payload.name || payload.preferred_username,
      roles: payload["roles"] || payload["custom:roles"] || [],
    };
  } catch {
    if (process.env.DEMO_OIDC_TOKEN && idToken === process.env.DEMO_OIDC_TOKEN) {
      return {
        sub: "demo-user",
        email: "demo@example.com",
        name: "Demo User",
        roles: ["SuperAdmin"],
      };
    }
    return null;
  }
}

function validatePassword(payload: { username?: string; password?: string }): OidcClaims | null {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword && payload.password === adminPassword) {
    return {
      sub: payload.username || "local-admin",
      email: payload.username || "admin@example.com",
      name: payload.username || "Local Admin",
      roles: ["SuperAdmin"],
    };
  }
  return null;
}

export async function GET() {
  const { getSessionFromCookies } = await import("../../../lib/auth/session");
  const session = getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json({ session });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { idToken } = body;
  let claims: OidcClaims | null = validateIdToken(idToken);
  if (!claims) {
    claims = validatePassword(body);
  }
  if (!claims) {
    return NextResponse.json({ error: "authentication_failed" }, { status: 401 });
  }
  const session: Session = {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    roles: mapRoles(claims),
  };
  persistSession(session);
  return NextResponse.json({ session });
}

export async function DELETE() {
  clearSession();
  return NextResponse.json({ ok: true });
}
