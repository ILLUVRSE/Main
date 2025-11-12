/**
 * ws.ts
 *
 * Lightweight browser WebSocket client with automatic reconnect and simple
 * pub/sub for notifications. Intended to connect to the server notifications
 * WebSocket at /ws/notifications (or configurable path).
 *
 * Usage:
 *  import notificationsClient from "../services/ws";
 *  notificationsClient.addListener((msg) => { ... });
 *  notificationsClient.connect();
 *
 * Listeners receive `event: { type, payload, ts }` parsed from server JSON.
 */
export class NotificationsClient {
    urlPath = "/ws/notifications";
    socket = null;
    listeners = new Set();
    reconnectAttempts = 0;
    maxReconnectDelay = 30_000;
    closedExplicitly = false;
    constructor(path) {
        if (path)
            this.urlPath = path;
    }
    /** Build a ws:// or wss:// URL that matches the page origin. */
    buildUrl() {
        const loc = window.location;
        const protocol = loc.protocol === "https:" ? "wss" : "ws";
        // Use same host/port as page and append urlPath
        return `${protocol}://${loc.host}${this.urlPath}`;
    }
    /** Connect (idempotent). */
    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.closedExplicitly = false;
        const url = this.buildUrl();
        try {
            this.socket = new WebSocket(url);
        }
        catch (err) {
            // Schedule reconnect
            this.scheduleReconnect();
            return;
        }
        this.socket.addEventListener("open", () => {
            this.reconnectAttempts = 0;
            // Send a hello/ping to identify (optional)
            try {
                this.socket?.send(JSON.stringify({ type: "hello", ts: Date.now() }));
            }
            catch { }
        });
        this.socket.addEventListener("message", (ev) => {
            try {
                const data = JSON.parse(ev.data);
                // normalize: ensure type exists
                const msg = {
                    type: String(data.type || data.event || "message"),
                    payload: data.payload ?? data,
                    id: data.id,
                    ts: data.ts ?? Date.now()
                };
                for (const l of Array.from(this.listeners)) {
                    try {
                        l(msg);
                    }
                    catch { }
                }
            }
            catch (err) {
                // ignore malformed messages
                console.warn("[notifications] malformed message", String(err));
            }
        });
        this.socket.addEventListener("close", (ev) => {
            this.socket = null;
            if (!this.closedExplicitly) {
                this.scheduleReconnect();
            }
        });
        this.socket.addEventListener("error", (ev) => {
            // close socket on error to trigger reconnect logic
            try {
                this.socket?.close();
            }
            catch { }
        });
    }
    /** Disconnect and stop reconnect attempts. */
    disconnect() {
        this.closedExplicitly = true;
        if (this.socket) {
            try {
                this.socket.close();
            }
            catch { }
            this.socket = null;
        }
    }
    /** Add a listener, returns a remover function. */
    addListener(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    removeListener(fn) {
        this.listeners.delete(fn);
    }
    /** Send a JSON-serializable payload to the server (best-effort). */
    send(evt) {
        try {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(evt));
            }
        }
        catch {
            // ignore
        }
    }
    /** Schedule a reconnect with exponential backoff. */
    scheduleReconnect() {
        this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 16);
        const backoff = Math.min(1000 * Math.pow(1.8, this.reconnectAttempts), this.maxReconnectDelay);
        setTimeout(() => {
            if (!this.closedExplicitly)
                this.connect();
        }, backoff);
    }
}
/** Default singleton instance that components can import and use. */
const notificationsClient = new NotificationsClient("/ws/notifications");
export default notificationsClient;
