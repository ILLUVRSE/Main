/**
 * openaiMock.ts
 *
 * A tiny Express app that mimics the OpenAI chat/completions endpoint for tests.
 * - POST /v1/chat/completions
 *    - if body.stream === true -> responds with a minimal SSE stream (data: ...\n\n + [DONE])
 *    - otherwise -> responds with a JSON completion resembling OpenAI's shape
 *
 * Export `createOpenAIMock()` so tests can `import` and mount it (or start standalone).
 */

import express, { Request, Response } from "express";

export function createOpenAIMock() {
  const app = express();
  app.use(express.json());

  app.post("/v1/chat/completions", (req: Request, res: Response) => {
    const { stream } = req.body || {};

    // Deterministic result that matches the planner/clients expectations:
    // the model returns a JSON string inside choices[0].message.content
    const modelOutput = {
      steps: [
        {
          explanation: "Create a hello.txt file with greeting",
          patches: [
            {
              path: "hello.txt",
              content: "Hello from RepoWriter mock!\n"
            }
          ]
        }
      ]
    };

    if (stream) {
      // SSE/streaming style: send a single data chunk then [DONE].
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      // Send one chunk containing the JSON payload (as string) and then finish.
      const payload = JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelOutput) } }]
      });

      // write a short delay to simulate streaming
      setTimeout(() => {
        res.write(`data: ${payload}\n\n`);
        setTimeout(() => {
          res.write(`data: [DONE]\n\n`);
          res.end();
        }, 10);
      }, 10);

      return;
    }

    // Non-streaming: respond with expected OpenAI-like structure
    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify(modelOutput)
          }
        }
      ]
    });
  });

  // Simple health endpoint for tests
  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}

if (require.main === module) {
  const port = Number(process.env.OPENAI_MOCK_PORT || 9876);
  const app = createOpenAIMock();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`OpenAI mock listening on http://localhost:${port}`);
  });
}

