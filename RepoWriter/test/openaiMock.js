#!/usr/bin/env node
const express = require('express');
const app = express();
app.use(express.json());

app.post('/v1/chat/completions', (req, res) => {
  const { stream } = req.body || {};

  const modelOutput = {
    steps: [
      {
        explanation: "Create a hello.txt file with greeting",
        patches: [
          { path: "hello.txt", content: "Hello from RepoWriter mock!\n" }
        ]
      }
    ]
  };

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    const payload = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }]
    });

    setTimeout(() => {
      res.write(`data: ${payload}\n\n`);
      setTimeout(() => {
        res.write('data: [DONE]\n\n');
        res.end();
      }, 10);
    }, 10);
    return;
  }

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

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.OPENAI_MOCK_PORT || 9876;
app.listen(port, () => {
  console.log(`OpenAI mock listening on http://localhost:${port}`);
});

