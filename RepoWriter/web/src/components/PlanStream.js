import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
/**
 * PlanStream
 *
 * Sends the prompt to the server's streaming endpoint via POST and reads the response body
 * as an event-stream-style payload. It collects 'data: ...' events, emits each raw payload
 * via onChunk, and calls onDone when finished. The component exposes Start/Stop controls
 * and shows the streaming text in a textarea-like box.
 *
 * Note: The server expects JSON body { prompt, memory } and responds with SSE-style data events.
 */
export default function PlanStream({ prompt, memory = [], endpoint = "/api/openai/stream", onChunk, onDone, onError, startOnMount = false, className, }) {
    const [status, setStatus] = useState("idle");
    const [text, setText] = useState("");
    const controllerRef = useRef(null);
    useEffect(() => {
        if (startOnMount && prompt) {
            startStream();
        }
        return () => {
            stopStream();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    async function startStream() {
        stopStream();
        if (!prompt || prompt.trim() === "") {
            return;
        }
        setText("");
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
                throw new Error(`Server ${res.status}: ${t}`);
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
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                // Process double-newline separated SSE events (data: ...)
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
                            // finished
                            setStatus("done");
                            onDone?.();
                            try {
                                reader.cancel();
                            }
                            catch { }
                            return;
                        }
                        // payload is often JSON or JSON fragments; append raw
                        // Unescape any escaped newlines we encoded server-side
                        const decoded = payload.replace(/\\n/g, "\n");
                        setText((s) => s + decoded);
                        onChunk?.(decoded);
                    }
                }
                // If buffer ends with newline without double newline, try to process line-by-line
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
                            return;
                        }
                        const decoded = payload.replace(/\\n/g, "\n");
                        setText((s) => s + decoded);
                        onChunk?.(decoded);
                    }
                }
            }
            // process any leftover buffer
            if (buf.trim()) {
                const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
                for (const line of lines) {
                    if (!line.startsWith("data:"))
                        continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") {
                        setStatus("done");
                        onDone?.();
                        return;
                    }
                    const decoded = payload.replace(/\\n/g, "\n");
                    setText((s) => s + decoded);
                    onChunk?.(decoded);
                }
            }
            setStatus("done");
            onDone?.();
        }
        catch (err) {
            if (err?.name === "AbortError") {
                setStatus("idle");
                return;
            }
            setStatus("error");
            onError?.(err);
        }
        finally {
            controllerRef.current = null;
        }
    }
    function stopStream() {
        if (controllerRef.current) {
            try {
                controllerRef.current.abort();
            }
            catch { }
            controllerRef.current = null;
        }
        if (status === "streaming") {
            setStatus("idle");
        }
    }
    return (_jsxs("div", { className: className, children: [_jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 8 }, children: [_jsx("button", { onClick: startStream, disabled: !prompt || status === "streaming", children: status === "streaming" ? "Streaming…" : "Start" }), _jsx("button", { onClick: stopStream, disabled: status !== "streaming", children: "Stop" }), _jsx("div", { style: { marginLeft: "auto", color: status === "error" ? "#f43f5e" : "#0f172a" }, children: status === "idle" ? "idle" : status })] }), _jsx("div", { style: { border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, minHeight: 120 }, children: _jsx("pre", { style: { whiteSpace: "pre-wrap", margin: 0, fontFamily: "Menlo, Monaco, monospace", fontSize: 13 }, children: text || (status === "idle" ? "No output yet. Start the stream to see plan fragments." : "") }) })] }));
}
