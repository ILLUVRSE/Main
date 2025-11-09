// app/login/page.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function submit(e: any) {
    e.preventDefault();
    const resp = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (resp.ok) {
      Cookies.set("commandpad_token", "1", { expires: 1 / 24 }); // 1 hour
      router.push("/");
    } else {
      const j = await resp.json().catch(() => ({}));
      setErr(j.error || "login failed");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="bg-white p-8 rounded shadow w-full max-w-md">
        <h1 className="text-xl font-bold mb-4">CommandPad Login</h1>
        <input
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border p-2 mb-3"
          placeholder="Admin password"
        />
        <button className="w-full bg-blue-600 text-white p-2 rounded">Login</button>
        {err && <div className="mt-2 text-red-500">{err}</div>}
      </form>
    </div>
  );
}

