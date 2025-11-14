let wssRef = null;
export function initWs(wss) {
    wssRef = wss;
    wss.on("connection", (ws) => {
        ws.send(JSON.stringify({ type: "hello", data: "RepoWriter WS connected" }));
    });
}
export function broadcast(type, data) {
    if (!wssRef)
        return;
    const msg = JSON.stringify({ type, data });
    for (const client of wssRef.clients) {
        if (client.readyState === 1)
            client.send(msg);
    }
}
