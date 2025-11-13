/**
 * notifications.ts
 *
 * Lightweight WebSocket notifications hub used by server to broadcast
 * apply/validate/commit events to connected UI clients.
 *
 * Usage:
 *   - Call `initNotifications(wss)` with an existing ws.WebSocketServer instance
 *     (e.g., created in src/ws/server.ts or src/index.ts).
 *   - Use exported `broadcast(event)` to send structured JSON events to all clients.
 *
 * Protocol:
 *  - Server -> Client messages: JSON objects with shape:
 *      { type: string, id?: string, payload?: any, ts?: number }
 *
 *  - Client may send:
 *      { type: "ping" }  -> server replies with { type: "pong" }
 *
 * This module is intentionally minimal and does not implement auth; the server
 * should restrict access to the WebSocket endpoint as appropriate.
 */

import { WebSocketServer, WebSocket } from "ws";
import { logInfo, logWarn } from "../telemetry/logger";

type Notification = {
  type: string;
  id?: string;
  payload?: any;
  ts?: number;
};

let wssRef: WebSocketServer | null = null;

export function initNotifications(wss: WebSocketServer) {
  if (!wss) throw new Error("WebSocketServer required");
  wssRef = wss;

  wss.on("connection", (ws: WebSocket, req) => {
    const remote = (req.socket && req.socket.remoteAddress) || "unknown";
    logInfo(`notifications: client connected`, { remote });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg && msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        } else {
          // ignore other client messages for now
        }
      } catch (err) {
        logWarn(`notifications: invalid client message`, { raw: String(raw) });
      }
    });

    ws.on("close", () => {
      logInfo(`notifications: client disconnected`, { remote });
    });

    ws.on("error", (err: any) => {
      logWarn(`notifications: socket error`, { error: String(err?.message || err) });
    });
  });
}

/** Broadcast a notification to all connected clients (best-effort). */
export function broadcast(event: Notification) {
  try {
    const wss = wssRef;
    if (!wss) {
      logWarn(`notifications: broadcast requested but wss not initialized`);
      return;
    }
    const msg = JSON.stringify({ ...event, ts: Date.now() });
    for (const client of Array.from(wss.clients)) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(msg);
        } catch (err) {
          // swallow errors per-client
        }
      }
    }
  } catch (err: any) {
    logWarn(`notifications: broadcast failed`, { error: String(err?.message || err) });
  }
}

export default { initNotifications, broadcast };
