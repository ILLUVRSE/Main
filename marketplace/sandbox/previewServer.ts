import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';

type PreviewRequestBody = {
  skuId: string;
  input: string;
  versionId?: string;
  temperature?: number;
};

interface PreviewSession extends PreviewRequestBody {
  sessionId: string;
  createdAt: number;
}

const TOKEN_BANK = [
  'sentinel',
  'mesh',
  'cursor',
  'quant',
  'vault',
  'lattice',
  'hydra',
  'atlas',
  'guardian',
  'illuvium',
  'cartographer',
  'perimeter',
  'specter',
  'ambient',
  'flux',
  'delta',
  'lambda',
  'verifier',
  'notary',
  'cronos',
  'azimuth',
  'uplink',
  'vector',
  'ledger',
  'aperture',
  'mirror',
  'zenith',
  'relay',
  'cortex',
  'synthesis',
  'halo',
  'phase',
];

const DEFAULT_PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 8081);
const BASE_WS_PATH = process.env.PREVIEW_WS_BASE ?? '/preview';

class SessionStore {
  private readonly sessions = new Map<string, PreviewSession>();

  createSession(payload: PreviewRequestBody): PreviewSession {
    const sessionId = crypto.randomUUID();
    const session: PreviewSession = {
      ...payload,
      sessionId,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  consume(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
    }
    return session;
  }
}

export function buildPreviewTokens(payload: PreviewRequestBody, maxTokens = 32) {
  const seed = `${payload.skuId}:${payload.versionId ?? 'latest'}:${payload.input}`;
  const hash = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const tokens: string[] = [];
  for (let i = 0; i < maxTokens; i += 1) {
    const byte = hash[i % hash.length];
    const vocabIndex = byte % TOKEN_BANK.length;
    tokens.push(TOKEN_BANK[vocabIndex]);
  }
  return tokens;
}

export function streamTokens(socket: WebSocket, payload: PreviewRequestBody) {
  const tokens = buildPreviewTokens(payload, 48);
  let index = 0;
  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }
    if (index >= tokens.length) {
      socket.send(JSON.stringify({ type: 'done', final_text: tokens.join(' ') }));
      clearInterval(interval);
      socket.close(1000, 'preview-complete');
      return;
    }
    socket.send(JSON.stringify({ type: 'token', text: `${tokens[index]} ` }));
    index += 1;
  }, 150);

  socket.on('close', () => {
    clearInterval(interval);
  });
}

export function startPreviewSandbox(port = DEFAULT_PREVIEW_PORT) {
  const app = express();
  const sessionStore = new SessionStore();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'preview-sandbox' });
  });

  app.post('/api/preview', (req, res) => {
    const body: PreviewRequestBody = req.body ?? {};
    if (!body.skuId || !body.input) {
      return res.status(400).json({ error: 'skuId and input are required' });
    }
    const session = sessionStore.createSession(body);
    const wsUrl = `ws://127.0.0.1:${port}${BASE_WS_PATH}/${session.sessionId}`;
    return res.status(201).json({
      sessionId: session.sessionId,
      wsUrl,
      expiresAt: new Date(session.createdAt + 5 * 60 * 1000).toISOString(),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, req) => {
    const url = req.url ?? '';
    const parts = url.split('/').filter(Boolean);
    const sessionId = parts[parts.length - 1]?.split('?')[0];
    if (!sessionId) {
      socket.close(4001, 'missing-session-id');
      return;
    }
    const session = sessionStore.consume(sessionId);
    if (!session) {
      socket.close(4404, 'session-not-found');
      return;
    }
    streamTokens(socket, session);
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[preview-sandbox] listening on http://127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  startPreviewSandbox();
}
