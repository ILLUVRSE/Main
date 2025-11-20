import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestPreviewSession } from "@/lib/api";
import { MarketplaceModel } from "@/lib/types";

type PreviewStatus = "idle" | "connecting" | "streaming" | "done" | "error";

interface PreviewPanelProps {
  model: MarketplaceModel;
  open: boolean;
  onClose: () => void;
  versionId?: string;
}

export function PreviewPanel({ model, open, onClose, versionId }: PreviewPanelProps) {
  const defaultPrompt = useMemo(() => model.examples[0]?.input ?? `Preview ${model.title}`, [model]);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const promptRef = useRef(defaultPrompt);
  const [tokens, setTokens] = useState<string[]>([]);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const connect = useCallback(
    async (input: string) => {
      if (typeof window === "undefined") return;
      cleanup();
      setTokens([]);
      setStatus("connecting");
      setError(null);
      try {
        const session = await requestPreviewSession({
          skuId: model.id,
          versionId,
          input,
        });
        const socket = new window.WebSocket(session.wsUrl);
        wsRef.current = socket;
        socket.onopen = () => setStatus("streaming");
        socket.onerror = () => {
          setError("Preview connection lost. Retry in a moment.");
          setStatus("error");
        };
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data.toString());
            if (payload.type === "token" && payload.text) {
              setTokens((current) => [...current, payload.text as string]);
            }
            if (payload.type === "done") {
              setStatus("done");
              cleanup();
            }
          } catch (err) {
            console.warn("Malformed preview payload", err);
          }
        };
        socket.onclose = () => {
          setStatus((prev) => (prev === "streaming" ? "done" : prev));
        };
      } catch (err) {
        console.error("Preview session failed", err);
        setError("Unable to start preview. Please retry.");
        setStatus("error");
      }
    },
    [cleanup, model.id, versionId]
  );

  useEffect(() => {
    setPrompt(defaultPrompt);
    promptRef.current = defaultPrompt;
  }, [defaultPrompt]);

  useEffect(() => {
    if (open) {
      connect(promptRef.current);
    } else {
      cleanup();
      setStatus("idle");
      setTokens([]);
    }
    return cleanup;
  }, [cleanup, connect, open]);

  if (!open) {
    return null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    connect(promptRef.current);
  }

  function handleCancel() {
    cleanup();
    setStatus("idle");
    setTokens([]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-10">
      <div
        role="dialog"
        aria-modal
        aria-label={`Preview ${model.title}`}
        className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950 p-8 shadow-2xl"
      >
        <button
          type="button"
          onClick={handleCancel}
          className="absolute right-4 top-4 rounded-full border border-white/20 p-2 text-slate-300 hover:text-white"
          aria-label="Close preview"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </button>
        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-brand-accent">Preview Sandbox</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">{model.title}</h2>
            <p className="text-sm text-slate-400">Streaming tokens from secure preview mesh.</p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 lg:flex-row">
            <label className="flex-1">
              <span className="sr-only">Preview prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.currentTarget.value);
                  promptRef.current = event.currentTarget.value;
                }}
                className="h-32 w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white focus:border-brand focus:outline-none"
                placeholder="Provide a prompt to test this manifest"
              />
            </label>
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                className="rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                {status === "streaming" ? "Streaming" : "Stream preview"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => connect(promptRef.current)}
                className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-300 hover:border-brand"
              >
                Retry
              </button>
            </div>
          </form>
          <div className="rounded-3xl border border-white/10 bg-black/40 p-4" aria-live="polite">
            <pre data-testid="preview-output" className="h-72 overflow-auto whitespace-pre-wrap text-sm text-slate-100">
              {tokens.length ? tokens.join("") : "Awaiting tokens..."}
            </pre>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-400" data-testid="preview-status">
            <span>
              Status: <strong className="uppercase text-white">{status}</strong>
            </span>
            {error && <span className="text-rose-400">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
