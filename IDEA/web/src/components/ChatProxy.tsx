import React, { useCallback, useState } from "react";

type ChatMessage = {
  role: string;
  content: string;
};

type RenderProps = {
  send: (messages: ChatMessage[]) => Promise<string>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
};

type ChatProxyProps = {
  children: (props: RenderProps) => React.ReactNode;
};

const API = import.meta.env.VITE_API ?? "http://127.0.0.1:5175";

const ChatProxy: React.FC<ChatProxyProps> = ({ children }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (messages: ChatMessage[]) => {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be provided");
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.error ?? "Chat request failed");
      }
      return String(json.text ?? "");
    } catch (err: any) {
      const message = err?.message ?? "Chat request failed";
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return <>{children({ send, busy, error, clearError })}</>;
};

export default ChatProxy;
export type { ChatMessage, ChatProxyProps, RenderProps };
