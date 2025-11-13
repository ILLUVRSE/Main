"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import "./login.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function submit(e: any) {
    e.preventDefault();
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (resp.ok) {
        Cookies.set("controlpanel_token", "1", { expires: 1 / 24 }); // 1 hour
        Cookies.set("controlpanel_role", "SuperAdmin", { expires: 1 / 24 });
        router.push("/");
      } else {
        const j = await resp.json().catch(() => ({}));
        setErr(j.error || "login failed");
      }
    } catch (e: any) {
      setErr(e?.message || "network error");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">ControlPanel Login</h1>
        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151" }}>
            Admin password
          </label>
          <input
            autoFocus
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            type="password"
          />
          <button type="submit" className="button">Login</button>
          {err && <div style={{ marginTop: 10, color: "#ef4444" }}>{err}</div>}
        </form>

        <div className="note">Placeholder admin UI — do not expose publicly without SSO/2FA.</div>
      </div>
    </div>
  );
}
