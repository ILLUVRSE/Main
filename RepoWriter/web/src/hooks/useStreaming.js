import { useCallback, useEffect, useRef, useState } from "react";
/**
 * useStreaming
 *
 * Lightweight hook to POST a prompt to a streaming endpoint (SSE-style `data:` events)
 * and accumulate emitted chunks. Caller can optionally observe chunks via onChunk/onDone/onError.
 *
 * Defaults to endpoint "/api/openai/stream" but you can pass a custom endpoint by setting
 * the `STREAM_ENDPOINT` env var (or replace the constant below).
 */
const DEFAULT_ENDPOINT = "/api/openai/stream";
export default function useStreaming({ endpoint = DEFAULT_ENDPOINT, onChunk, onDone, onError, } = {}) {
    const [status, setStatus] = useState("idle");
    const [text, setText] = useState("");
    const [error, setError] = useState(null);
    const controllerRef = useRef(null);
    const readerRef = useRef(null);
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try {
                controllerRef.current?.abort();
            }
            catch { }
            readerRef.current = null;
            controllerRef.current = null;
        };
    }, []);
    const stop = useCallback(() => {
        if (controllerRef.current) {
            try {
                controllerRef.current.abort();
            }
            catch { }
            controllerRef.current = null;
        }
        if (readerRef.current) {
            try {
                readerRef.current.cancel();
            }
            catch { }
            readerRef.current = null;
        }
        if (status === "streaming")
            setStatus("idle");
    }, [status]);
    const start = useCallback(async (prompt, memory = []) => {
        stop();
        setText("");
        setError(null);
        setStatus("streaming");
        const ac = new AbortController();
        controllerRef.current = ac;
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, memory }),
                signal: ac.signal,
            });
            if (!res.ok) {
                const t = await res.text();
                const err = new Error(`Server ${res.status}: ${t}`);
                setError(err);
                setStatus("error");
                onError?.(err);
                return;
            }
            if (!res.body) {
                const t = await res.text();
                setText((s) => s + t);
                onChunk?.(t);
                setStatus("done");
                onDone?.();
                return;
            }
            const reader = res.body.getReader();
            readerRef.current = reader;
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                // Process SSE-style events separated by double-newline
                let idx;
                while ((idx = buf.indexOf("\n\n")) !== -1) {
                    const rawEvent = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    const lines = rawEvent.split("\n").map((l) => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        if (!line.startsWith("data:"))
                            continue;
                        const payload = line.slice(5).trim();
                        if (payload === "[DONE]") {
                            setStatus("done");
                            onDone?.();
                            try {
                                reader.cancel();
                            }
                            catch { }
                            readerRef.current = null;
                            controllerRef.current = null;
                            return;
                        }
                        const decoded = payload.replace(/\\n/g, "\n");
                        setText((s) => s + decoded);
                        onChunk?.(decoded);
                    }
                }
                // If buffer ends with newline (single-line), try to process line(s)
                if (buf.endsWith("\n")) {
                    const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
                    buf = "";
                    for (const line of lines) {
                        if (!line.startsWith("data:"))
                            continue;
                        const payload = line.slice(5).trim();
                        if (payload === "[DONE]") {
                            setStatus("done");
                            onDone?.();
                            try {
                                reader.cancel();
                            }
                            catch { }
                            readerRef.current = null;
                            controllerRef.current = null;
                            return;
                        }
                        const decoded = payload.replace(/\\n/g, "\n");
                        setText((s) => s + decoded);
                        onChunk?.(decoded);
                    }
                }
            }
            // process remaining buffer
            if (buf.trim()) {
                const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
                for (const line of lines) {
                    if (!line.startsWith("data:"))
                        continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") {
                        setStatus("done");
                        onDone?.();
                        readerRef.current = null;
                        controllerRef.current = null;
                        return;
                    }
                    const decoded = payload.replace(/\\n/g, "\n");
                    setText((s) => s + decoded);
                    onChunk?.(decoded);
                }
            }
            setStatus("done");
            onDone?.();
            readerRef.current = null;
            controllerRef.current = null;
        }
        catch (err) {
            if (err?.name === "AbortError") {
                // aborted by stop(); treat as idle
                setStatus("idle");
                return;
            }
            const e = err instanceof Error ? err : new Error(String(err));
            setError(e);
            setStatus("error");
            onError?.(e);
            readerRef.current = null;
            controllerRef.current = null;
        }
    }, [endpoint, onChunk, onDone, onError, stop]);
    return { start, stop, status, text, error };
}
