# Local LLM — Running and Configuring a Local Model for RepoWriter

This guide explains how to run and configure a **local/offline LLM** for RepoWriter’s **Left Task Board** and **local planner** endpoints. RepoWriter includes a small server-side proxy (`/api/llm/local/*`) and a client helper (`web/src/services/llm.ts`) that allow the web UI to communicate with local models in a consistent way.

---

## Recommended Local LLM Servers

Choose based on your hardware and use case:

### 1. **text-generation-webui** (GPU or CPU builds)

* Flexible web UI with support for many model backends (GGML, Hugging Face, etc.).
* Common HTTP endpoints:

  * `POST /generate` → `{ text }` or `{ results:[{text}] }`
  * `POST /api/generate` (alternate)
* Supports streaming via chunked responses or SSE in some versions.
* **Default URL:** `http://127.0.0.1:7860/`

### 2. **OpenAI-Compatible Adapters** (e.g., text-generation-inference, Ollama)

* Expose OpenAI-style API endpoints such as `POST /v1/chat/completions`.
* Preferred by RepoWriter for compatibility with the OpenAI API format.

### 3. **llama.cpp / GGML + WebUI Wrappers**

* Efficient CPU backends. Combine with a web UI wrapper (like `text-generation-webui`, `llama.cpp webui`, or **Ollama**) for HTTP access.

### 4. **Ollama**

* Provides an OpenAI-like local API and supports both chat and streaming operations.

---

## How RepoWriter Connects to a Local LLM

### Pattern 1: **Frontend → Server Proxy → Local LLM** (Default)

* The UI calls `/api/llm/local/*` on the RepoWriter server.
* The server proxies requests to your configured `LOCAL_LLM_URL`.
* Benefits: normalized output, retry handling, streaming support, and no CORS issues.

### Pattern 2: **Frontend → Local LLM Directly**

* Not recommended (CORS/auth issues).
* To use this mode, modify `web/src/services/llm.ts` to call your LLM directly.

---

## Configuration

### Server Environment Variable

Set the local LLM endpoint in your server environment (e.g., `.env` file):

```bash
export LOCAL_LLM_URL="http://127.0.0.1:7860"
```

Restart the server after updating this variable. The proxy (`localllm.ts`) will prioritize this setting.

### Frontend Settings

In the RepoWriter UI:

* **Backend:** Local LLM
* **Local LLM URL:** `http://127.0.0.1:7860`
* **Local Model:** Model name recognized by your backend (optional)

Settings persist in `localStorage` and automatically propagate throughout the UI.

---

## Expected Endpoints

The RepoWriter server tries common endpoints automatically:

### **OpenAI-like `/v1/chat/completions`** (Preferred)

**Request:**

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "...instructions..."},
    {"role": "user", "content": "your prompt"}
  ],
  "temperature": 0.2,
  "stream": true
}
```

**Response:**
OpenAI-style JSON (`choices[0].message.content`) or SSE stream.

### **text-generation-webui Style `/generate`**

**Request:**

```json
{
  "prompt": "your combined prompt",
  "max_new_tokens": 512,
  "temperature": 0.2
}
```

**Response:**
`{"text": "..."}` or `{ "results": [{ "text": "..." }] }`

### **Fallback**

If the root URL returns HTML or plain text, the proxy wraps it in a basic fallback response (for debugging).

---

## Streaming Support

* If your backend supports SSE or streaming, RepoWriter will forward chunks via `/api/llm/local/stream`.
* The frontend (`PlanStream`, `services/llm.ts`) supports both `data:`-based SSE and chunked text.
* If not supported, RepoWriter falls back to standard (non-streaming) responses.

---

## Tips for Reliable JSON Plans

Local models may produce less structured outputs. To improve reliability:

1. **Use Strict System Prompts** — define and show the JSON schema explicitly.
2. **Request Streaming Output** — streaming helps avoid long-format errors.
3. **Enable Heuristic JSON Extraction** — the proxy tries to recover valid JSON from malformed responses.
4. **Prefer `content` Fields** — simpler and more consistent than `diff` fields.

Example schema:

```json
{
  "steps": [
    {
      "explanation": "<string>",
      "patches": [
        { "path": "<repo path>", "content?": "<string>", "diff?": "<string>" }
      ]
    }
  ]
}
```

---

## Quick Start Recipes

### A. Test Without a Model

Run the built-in OpenAI mock:

```bash
node RepoWriter/test/openaiMock.js &
export OPENAI_API_URL="http://127.0.0.1:9876"
```

The mock listens on port `9876` and supports `/v1/chat/completions` for testing.

### B. Using text-generation-webui

```bash
export LOCAL_LLM_URL="http://127.0.0.1:7860"
npm --prefix RepoWriter/server run dev
```

Test the planner:

```bash
curl -sS -X POST http://localhost:7071/api/llm/local/plan \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create hello.txt with greeting"}' | jq .
```

### C. Using an OpenAI-Compatible Adapter

If your local adapter supports `/v1/chat/completions`, just set `LOCAL_LLM_URL` and start RepoWriter as usual.

---

## Troubleshooting

**Error:** `Local LLM: unable to contact local LLM server`

* Verify `LOCAL_LLM_URL` and that the model server is running.
* Test connectivity using `curl`.

**Error:** Plan returns unparsable output

* Tighten prompts with stricter system instructions.
* Inspect the raw response under `meta.raw` for clues.

**Streaming issues**

* Ensure your LLM supports streaming.
* Check logs (`RepoWriter/server/server.log`) for upstream errors.

---

## Advanced Configuration

* Modify `RepoWriter/server/src/routes/localllm.ts` to customize proxy heuristics or add authentication.
* Run OpenAI-compatible servers for best streaming and JSON consistency.

---

