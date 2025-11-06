// devops/mock-kms/server.js
// Minimal mock KMS for CI integration tests.
// - Responds 200 on `/` and `/ready`
// - Exposes a simple `/v1/status` and `/v1/keys/:id` for future tests
// - Graceful shutdown on SIGINT/SIGTERM

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', (_req, res) => {
  res.json({ status: 'ready' });
});

// Simple status endpoint used by tests
app.get('/v1/status', (_req, res) => {
  res.json({ service: 'mock-kms', status: 'ok', ts: new Date().toISOString() });
});

// A very small key lookup stub
app.get('/v1/keys/:id', (req, res) => {
  const { id } = req.params;
  // Return a fake public key body — useful for callers that expect JSON
  res.json({ id, keyType: 'mock-rsa', publicKey: `PUBLIC_KEY_FOR_${id}` });
});

const server = app.listen(PORT, () => {
  console.log(`mock-kms listening on ${PORT}`);
});

function shutdown() {
  console.log('mock-kms shutting down...');
  server.close(() => {
    console.log('server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('force exit');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

