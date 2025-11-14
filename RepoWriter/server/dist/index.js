import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer } from "ws";
// Log early to verify envs present
console.log("[Env] OPENAI_API_KEY prefix:", (process.env.OPENAI_API_KEY || "").slice(0, 10));
console.log("[Env] OPENAI_PROJECT_ID:", process.env.OPENAI_PROJECT_ID);
console.log("[Env] SANDBOX_ENABLED:", process.env.SANDBOX_ENABLED);
console.log("[Env] REPOWRITER_ALLOW_NO_KEY:", process.env.REPOWRITER_ALLOW_NO_KEY);
console.log("[Env] GITHUB_TOKEN present:", !!process.env.GITHUB_TOKEN);
process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err && (err.stack || err));
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
    process.exit(1);
});
async function main() {
    try {
        // Defer heavy imports so we can see env logs first
        const { default: app } = await import("./app.js");
        const { initWs } = await import("./ws/server.js");
        const convManagerMod = await import("./services/conversationManager.js");
        // Initialize conversation manager (loads persisted conversations, starts flush timer)
        try {
            await convManagerMod.initConversationManager();
            console.log("[RepoWriter] conversationManager initialized");
        }
        catch (err) {
            console.warn("[RepoWriter] conversationManager init failed:", err && (err.stack || err));
        }
        const port = Number(process.env.PORT || 7071);
        const server = createServer(app);
        const wss = new WebSocketServer({ server, path: "/ws" });
        initWs(wss);
        server.listen(port, () => {
            console.log(`[RepoWriter] server listening on http://localhost:${port}`);
            if (process.env.SANDBOX_ENABLED === "1") {
                console.log("[RepoWriter] sandbox: enabled");
            }
            else {
                console.log("[RepoWriter] sandbox: disabled (set SANDBOX_ENABLED=1 to enable)");
            }
        });
    }
    catch (err) {
        console.error("[startup error]", err && (err.stack || err));
        process.exit(1);
    }
}
main();
