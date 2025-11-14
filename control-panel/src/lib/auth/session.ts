import crypto from "crypto";
import { Buffer } from "node:buffer";
import { cookies } from "next/headers";

const SESSION_COOKIE = "cp_session_v1";
const SESSION_SECRET = process.env.CONTROL_PANEL_SESSION_SECRET || "dev-session-secret";

export type Session = {
  sub: string;
  email?: string;
  name?: string;
  roles: string[];
};

function sign(value: string) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function decodeSession(cookieValue?: string | null): Session | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const data = JSON.parse(json);
    if (!Array.isArray(data.roles)) {
      data.roles = [];
    }
    return data;
  } catch {
    return null;
  }
}

export function getSessionFromCookies(): Session | null {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  return decodeSession(raw);
}

export function persistSession(session: Session) {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, encodeSession(session), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });
}

export function clearSession() {
  const cookieStore = cookies();
  cookieStore.delete(SESSION_COOKIE);
}
