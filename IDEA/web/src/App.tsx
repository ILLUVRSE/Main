import React, { useEffect, useState } from "react";
import ChatProxy, { ChatMessage } from "./components/ChatProxy";

const API = import.meta.env.VITE_API ?? "http://127.0.0.1:5175";

type Role = "user" | "assistant" | "system";
type Message = { role: Role; content: string };

type Profile = "illuvrse" | "personal";

export default function App() {
  const [health, setHealth] = useState<string>("checking…");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [profile, setProfile] = useState<Profile>("illuvrse");

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(j => setHealth(j?.ok ? "ok" : "error"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <ChatProxy>
      {({ send, busy, error, clearError }) => {
        const sendMessage = async () => {
          if (!input.trim() || busy) return;

          const userMsg: Message = { role: "user", content: input.trim() };
          setMessages(prev => [...prev, userMsg]);
          setInput("");
          clearError();

          const systemHint: Message | null =
            profile === "illuvrse"
              ? {
                  role: "system",
                  content:
                    "You are IDEA (ILLUVRSE). Require tests and clear diffs when proposing code changes."
                }
              : {
                  role: "system",
                  content: "Adopt a fast, informal tone geared toward quick iteration."
                };

          const conversation: ChatMessage[] = systemHint
            ? [systemHint, ...messages, userMsg]
            : [...messages, userMsg];

          try {
            const text = await send(conversation);
            setMessages(prev => [...prev, { role: "assistant", content: text }]);
          } catch {
            // errors are surfaced via ChatProxy state
          }
        };

        return (
          <div className="app">
            <h2>IDEA (ILLUVRSE)</h2>
            <div className="badge">Backend health: {health}</div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ opacity: 0.8 }}>Profile:</label>
              <select
                value={profile}
                onChange={e => setProfile(e.target.value as Profile)}
                style={{
                  background: "#12141a",
                  color: "#e6e6e6",
                  borderRadius: 8,
                  padding: "6px 8px",
                  border: "1px solid #333"
                }}
                disabled={busy}
              >
                <option value="illuvrse">ILLUVRSE (strict)</option>
                <option value="personal">Personal (relaxed)</option>
              </select>
              {busy && <span className="badge">thinking…</span>}
              {error && (
                <span className="badge" style={{ color: "#ff6b6b" }}>
                  error: {error}
                </span>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              {messages.map((m, i) => (
                <div key={i} className="msg">
                  <strong>
                    {m.role === "user" ? "You" : m.role === "assistant" ? "Assistant" : "System"}:
                  </strong>{" "}
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <input
                placeholder="Type a message…"
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  if (error) clearError();
                }}
                onKeyDown={e => (e.key === "Enter" ? sendMessage() : null)}
                disabled={busy}
              />
              <button onClick={sendMessage} disabled={busy}>
                Send
              </button>
            </div>
          </div>
        );
      }}
    </ChatProxy>
  );
}
