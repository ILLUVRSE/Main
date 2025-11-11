import type { WebSocketServer } from "ws";

let wssRef: WebSocketServer | null = null;

export function initWs(wss: WebSocketServer) {
  wssRef = wss;
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", data: "RepoWriter WS connected" }));
  });
}

export function broadcast(type: string, data: any) {
  if (!wssRef) return;
  const msg = JSON.stringify({ type, data });
  for (const client of wssRef.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

