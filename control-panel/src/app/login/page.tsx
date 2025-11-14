"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import "./login.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const resp = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: token || undefined, password, username: "local-admin" }),
      });
      if (resp.ok) {
        router.push("/");
      } else {
        const j = await resp.json().catch(() => ({}));
        setErr((j as { error?: string }).error || "login failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      setErr(message);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">ControlPanel Login</h1>
        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151" }}>
            OIDC token (optional)
          </label>
          <input
            className="input mb-3"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste id_token for SSO"
          />

          <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151" }}>
            Admin password (fallback)
          </label>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            type="password"
          />
          <button type="submit" className="button">Login</button>
          {err && <div style={{ marginTop: 10, color: "#ef4444" }}>{err}</div>}
        </form>

        <div className="note">Supports OIDC id_token or ADMIN_PASSWORD fallback for development.</div>
      </div>
    </div>
  );
}
